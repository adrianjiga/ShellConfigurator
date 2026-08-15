import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { WizardState, InstallTask, InstallStatus } from '../types.js';
import { WizardLayout } from '../components/WizardLayout.js';
import {
  buildTaskList,
  runInstallTasks,
  DEFAULT_INSTALL_TASK_DEPS,
} from '../services/installTasks.js';

interface InstallingScreenProps {
  state: WizardState;
  onNext: (update?: Partial<WizardState>) => void;
}

const STATUS_ICONS: Record<InstallStatus, string> = {
  pending: '[ ]',
  running: '[~]',
  done: '[✓]',
  failed: '[✗]',
  skipped: '[–]',
};

const STATUS_COLORS: Record<InstallStatus, string> = {
  pending: 'gray',
  running: 'yellow',
  done: 'green',
  failed: 'red',
  skipped: 'gray',
};

export function InstallingScreen({ state, onNext }: InstallingScreenProps) {
  const [tasks, setTasks] = useState<InstallTask[]>(() => buildTaskList(state));
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    let cancelled = false;

    function updateTask(id: string, patch: Partial<InstallTask>) {
      if (cancelled) return;
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    }

    (async () => {
      const results = await runInstallTasks(state, DEFAULT_INSTALL_TASK_DEPS, updateTask);

      // Advance after a brief pause so the user can see the final state
      await new Promise((r) => setTimeout(r, 1200));
      if (!cancelled) onNext({ installResults: results });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const allDone = tasks.every(
    (t) => t.status === 'done' || t.status === 'skipped' || t.status === 'failed'
  );

  return (
    <WizardLayout state={state} hidePreview>
      <Box flexDirection="column" gap={1}>
        <Text bold>Installing</Text>
        <Text color="gray">This may take a moment. sudo prompts will appear in the terminal.</Text>

        <Box flexDirection="column" marginTop={1} gap={0}>
          {tasks.map((task) => (
            <Box key={task.id} flexDirection="column">
              <Box flexDirection="row" gap={1}>
                <Text color={STATUS_COLORS[task.status]}>{STATUS_ICONS[task.status]}</Text>
                <Text
                  color={task.status === 'running' ? 'white' : STATUS_COLORS[task.status]}
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
