import { Box, Text, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';
import { WizardLayout } from '../components/WizardLayout.tsx';
import { statusMark } from '../config/status.ts';
import { killActiveCommand } from '../services/exec.ts';
import {
  buildTaskList,
  DEFAULT_INSTALL_TASK_DEPS,
  runInstallTasks,
} from '../services/installTasks.ts';
import { isUiSuspended, subscribeToUiSuspension } from '../services/tty.ts';
import type { InstallTask, WizardState } from '../types.ts';

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
      await new Promise((r) => setTimeout(r, 1200));
      if (!unmounted) onNext({ installResults: results });
    })();

    return () => {
      unmounted = true;
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
        <Text color="gray">This may take a moment. sudo prompts will appear in the terminal.</Text>
        {cancelling ? (
          <Text color="yellow">Cancelling — waiting for the current step to stop...</Text>
        ) : (
          <Text color="gray">
            Press <Text color="cyan">c</Text> to cancel.
          </Text>
        )}

        <Box flexDirection="column" marginTop={1} gap={0}>
          {tasks.map((task) => (
            <Box key={task.id} flexDirection="column">
              <Box flexDirection="row" gap={1}>
                <Text color={statusMark(task.status).color}>[{statusMark(task.status).icon}]</Text>
                <Text
                  color={task.status === 'running' ? 'white' : statusMark(task.status).color}
                  bold={task.status === 'running'}
                >
                  {task.label}
                </Text>
              </Box>
              {task.error && (
                <Box marginLeft={4}>
                  <Text color="red" italic>
                    {task.error}
                  </Text>
                </Box>
              )}
              {task.note && !task.error && (
                <Box marginLeft={4}>
                  <Text color="gray" italic>
                    {task.note}
                  </Text>
                </Box>
              )}
            </Box>
          ))}
        </Box>

        {allDone && (
          <Box marginTop={1}>
            <Text color="green">All done — continuing...</Text>
          </Box>
        )}
      </Box>
    </WizardLayout>
  );
}
