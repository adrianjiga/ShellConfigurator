import { Box, Text, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';
import { WizardLayout } from '../components/WizardLayout.tsx';
import { uiColor } from '../config/colors.ts';
import { statusMark } from '../config/status.ts';
import { errorMessage } from '../services/errors.ts';
import {
  buildTaskList,
  DEFAULT_INSTALL_TASK_DEPS,
  runInstallTasks,
} from '../services/installTasks.ts';
import { isUiSuspended, subscribeToUiSuspension } from '../services/tty.ts';
import type { InstallTask, InstallTaskId, WizardState } from '../types.ts';

export const ADVANCE_AFTER_DONE_MS = 1200;
let advanceDelayMs = ADVANCE_AFTER_DONE_MS;

/** Test-only: cut the post-install pause so flow tests don't sleep 1.2s per run. */
export function setAdvanceDelayForTests(ms: number): void {
  if (process.env.VITEST !== 'true') return;
  advanceDelayMs = ms;
}

interface InstallingScreenProps {
  state: WizardState;
  onNext: (update?: Partial<WizardState>) => void;
}

export function InstallingScreen({ state, onNext }: InstallingScreenProps) {
  const [tasks, setTasks] = useState<InstallTask[]>(() => buildTaskList(state));
  const [uiSuspended, setUiSuspended] = useState(() => isUiSuspended());
  const [cancelling, setCancelling] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // While a child owns the terminal it is in cooked mode, so Ctrl+C arrives as
  // SIGINT instead of a key. Cancel the run then instead of dying mid-install.
  useEffect(() => {
    const onSigint = () => {
      setCancelling(true);
      abortRef.current?.abort();
    };
    process.on('SIGINT', onSigint);
    return () => {
      process.off('SIGINT', onSigint);
    };
  }, []);

  // While an interactive child (sudo, chsh) owns the terminal this screen renders
  // nothing, so Ink's next frame cannot paint over its password prompt.
  useEffect(() => subscribeToUiSuspension(setUiSuspended), []);

  // Runs on mount. A remount (React StrictMode runs effects twice) aborts the
  // first run before any step starts and lets the second one finish.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the run starts once per mount.
  useEffect(() => {
    let unmounted = false;
    const controller = new AbortController();
    abortRef.current = controller;

    function updateTask(id: string, patch: Partial<InstallTask>) {
      if (unmounted) return;
      // The reset pass discovers shells at run time, after the plan was built,
      // so a task id the screen has not seen yet is added rather than dropped.
      setTasks((prev) =>
        prev.some((t) => t.id === id)
          ? prev.map((t) => (t.id === id ? { ...t, ...patch } : t))
          : [...prev, { id: id as InstallTaskId, label: id, status: 'pending', ...patch }]
      );
    }

    (async () => {
      let results: InstallTask[];
      try {
        results = await runInstallTasks(
          state,
          DEFAULT_INSTALL_TASK_DEPS,
          updateTask,
          controller.signal
        );
      } catch (err) {
        // The chain itself broke: report every step as failed rather than hang here.
        results = buildTaskList(state).map((task) => ({
          ...task,
          status: 'failed',
          error: errorMessage(err),
        }));
      }

      // Advance after a brief pause so the user can see the final state
      await new Promise((r) => setTimeout(r, advanceDelayMs));
      if (!unmounted) onNext({ installResults: results });
    })();

    return () => {
      unmounted = true;
      controller.abort();
    };
  }, []);

  // Only listen while this screen owns the terminal: during an interactive child
  // the keystrokes belong to that child, not to Ink.
  useInput(
    (char, key) => {
      // Nothing is left to cancel once every step has finished.
      if (allDoneRef.current) return;
      if (char === 'c' || char === 'C' || (key.ctrl && char === 'c')) {
        setCancelling(true);
        abortRef.current?.abort();
      }
    },
    { isActive: !uiSuspended }
  );

  const allDone = tasks.every(
    (t) => t.status === 'done' || t.status === 'skipped' || t.status === 'failed'
  );
  const allDoneRef = useRef(allDone);
  allDoneRef.current = allDone;

  // The child process is drawing to this terminal — stay out of its way.
  if (uiSuspended) return null;

  return (
    <WizardLayout state={state} hidePreview>
      <Box flexDirection="column" gap={1}>
        <Text bold>Installing</Text>
        <Text color={uiColor('gray')}>
          This may take a moment. sudo prompts will appear in the terminal.
        </Text>
        {cancelling ? (
          <Text color={uiColor('yellow')}>
            Cancelling — waiting for the current step to stop...
          </Text>
        ) : (
          <Text color={uiColor('gray')}>
            Press <Text color={uiColor('cyan')}>c</Text> to cancel.
          </Text>
        )}

        <Box flexDirection="column" marginTop={1} gap={0}>
          {tasks.map((task) => (
            <Box key={task.id} flexDirection="column">
              <Box flexDirection="row" gap={1}>
                <Text color={uiColor(statusMark(task.status).color)}>
                  [{statusMark(task.status).icon}]
                </Text>
                <Text
                  color={uiColor(
                    task.status === 'running' ? 'white' : statusMark(task.status).color
                  )}
                  bold={task.status === 'running'}
                >
                  {task.label}
                </Text>
              </Box>
              {task.error && (
                <Box marginLeft={4}>
                  <Text color={uiColor('red')} italic>
                    {task.error}
                  </Text>
                </Box>
              )}
              {task.note && !task.error && (
                <Box marginLeft={4}>
                  <Text color={uiColor('gray')} italic>
                    {task.note}
                  </Text>
                </Box>
              )}
            </Box>
          ))}
        </Box>

        {allDone && (
          <Box marginTop={1}>
            {tasks.some((t) => t.status === 'failed') ? (
              <Text color={uiColor('yellow')}>
                {cancelling ? 'Cancelled' : 'Finished with errors'} — continuing to the summary...
              </Text>
            ) : (
              <Text color={uiColor('green')}>All done — continuing...</Text>
            )}
          </Box>
        )}
      </Box>
    </WizardLayout>
  );
}
