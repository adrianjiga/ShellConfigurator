import { Box, Text, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';
import { WizardLayout } from '../components/WizardLayout.tsx';
import { uiColor } from '../config/colors.ts';
import { statusMark } from '../config/status.ts';
import { killActiveCommand } from '../services/exec.ts';
import {
  buildTaskList,
  DEFAULT_INSTALL_TASK_DEPS,
  runInstallTasks,
} from '../services/installTasks.ts';
import { isUiSuspended, subscribeToUiSuspension } from '../services/tty.ts';
import type { InstallTask, WizardState } from '../types.ts';

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
  const ran = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // While an interactive child (sudo, chsh) owns the terminal this screen renders
  // nothing, so Ink's next frame cannot paint over its password prompt.
  useEffect(() => subscribeToUiSuspension(setUiSuspended), []);

  // Runs once on mount: re-running would restart every install. The `ran` ref
  // guards double-invocation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mounts once; ran ref guards double-invocation.
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    let unmounted = false;
    const controller = new AbortController();
    abortRef.current = controller;

    function updateTask(id: string, patch: Partial<InstallTask>) {
      if (unmounted) return;
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    }

    (async () => {
      const results = await runInstallTasks(
        state,
        DEFAULT_INSTALL_TASK_DEPS,
        updateTask,
        controller.signal
      );

      // Advance after a brief pause so the user can see the final state
      await new Promise((r) => setTimeout(r, advanceDelayMs));
      if (!unmounted) onNext({ installResults: results });
    })();

    return () => {
      unmounted = true;
      controller.abort();
      killActiveCommand();
    };
  }, []);

  // Only listen while this screen owns the terminal: during an interactive child
  // the keystrokes belong to that child, not to Ink.
  useInput(
    (char, key) => {
      if (char === 'c' || char === 'C' || (key.ctrl && char === 'c')) {
        setCancelling(true);
        abortRef.current?.abort();
        // Stops the command already in flight; the task chain halts at the next checkpoint.
        killActiveCommand();
      }
    },
    { isActive: !uiSuspended }
  );

  const allDone = tasks.every(
    (t) => t.status === 'done' || t.status === 'skipped' || t.status === 'failed'
  );

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
            <Text color={uiColor('green')}>All done — continuing...</Text>
          </Box>
        )}
      </Box>
    </WizardLayout>
  );
}
