import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { WizardState, InstallTask, InstallStatus, FONT_SELECT_SENTINEL } from '../types.js';
import { WizardLayout } from '../components/WizardLayout.js';
import {
  installStarship,
  installShell,
  installNerdFont,
  setDefaultShell,
  NERD_FONTS,
} from '../services/installer.js';
import { writeStarshipConfig, applyShellConfig } from '../generators/shellRc.js';
import { generateToml } from '../generators/starship.js';
import { isStarshipInstalled } from '../services/detector.js';

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

function buildTaskList(state: WizardState): InstallTask[] {
  const tasks: InstallTask[] = [];

  // Starship
  tasks.push({ id: 'starship', label: 'Starship', status: 'pending' });

  // Nerd Font (skip sentinel value)
  if (state.nerdFontToInstall && state.nerdFontToInstall !== FONT_SELECT_SENTINEL) {
    const fontLabel =
      NERD_FONTS.find((f) => f.id === state.nerdFontToInstall)?.label ?? state.nerdFontToInstall;
    tasks.push({ id: 'font', label: `Nerd Font (${fontLabel})`, status: 'pending' });
  }

  // Shells that need installing
  for (const shellId of state.selectedShells) {
    if (!state.installedShells.includes(shellId)) {
      tasks.push({ id: `shell_${shellId}`, label: `Install ${shellId}`, status: 'pending' });
    }
  }

  // Set default shell
  if (state.setDefaultShell) {
    tasks.push({
      id: 'chsh',
      label: `Set ${state.setDefaultShell} as default shell`,
      status: 'pending',
    });
  }

  // Config write
  tasks.push({ id: 'config', label: 'Write starship.toml', status: 'pending' });

  // RC files
  tasks.push({ id: 'rc', label: 'Apply shell configs', status: 'pending' });

  return tasks;
}

export function InstallingScreen({ state, onNext }: InstallingScreenProps) {
  const [tasks, setTasks] = useState<InstallTask[]>(() => buildTaskList(state));
  const tasksRef = useRef(tasks);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    let cancelled = false;

    function updateTask(id: string, patch: Partial<InstallTask>) {
      if (cancelled) return;
      setTasks((prev) => {
        const next = prev.map((t) => (t.id === id ? { ...t, ...patch } : t));
        tasksRef.current = next;
        return next;
      });
    }

    (async () => {
      // --- Starship ---
      updateTask('starship', { status: 'running' });
      try {
        const check = isStarshipInstalled();
        if (check.installed) {
          updateTask('starship', {
            status: 'skipped',
            label: `Starship (${check.version ?? 'installed'})`,
          });
        } else {
          await installStarship(state.packageManager);
          updateTask('starship', { status: 'done' });
        }
      } catch (err) {
        updateTask('starship', { status: 'failed', error: String(err) });
      }

      // --- Nerd Font (skip sentinel value) ---
      if (state.nerdFontToInstall && state.nerdFontToInstall !== FONT_SELECT_SENTINEL) {
        updateTask('font', { status: 'running' });
        try {
          await installNerdFont(state.nerdFontToInstall);
          updateTask('font', { status: 'done' });
        } catch (err) {
          updateTask('font', { status: 'failed', error: String(err) });
        }
      }

      // --- Missing shells ---
      for (const shellId of state.selectedShells) {
        if (state.installedShells.includes(shellId)) continue;
        const taskId = `shell_${shellId}`;
        updateTask(taskId, { status: 'running' });
        try {
          await installShell(shellId, state.packageManager);
          updateTask(taskId, { status: 'done' });
        } catch (err) {
          updateTask(taskId, { status: 'failed', error: String(err) });
        }
      }

      // --- chsh ---
      if (state.setDefaultShell) {
        updateTask('chsh', { status: 'running' });
        try {
          await setDefaultShell(state.setDefaultShell);
          updateTask('chsh', { status: 'done' });
        } catch (err) {
          updateTask('chsh', { status: 'failed', error: String(err) });
        }
      }

      // --- Write starship.toml ---
      updateTask('config', { status: 'running' });
      try {
        const toml = generateToml(state);
        writeStarshipConfig(toml);
        updateTask('config', { status: 'done' });
      } catch (err) {
        updateTask('config', { status: 'failed', error: String(err) });
      }

      // --- Apply shell RC files ---
      updateTask('rc', { status: 'running' });
      try {
        for (const shellId of state.selectedShells) {
          applyShellConfig(shellId);
        }
        updateTask('rc', { status: 'done' });
      } catch (err) {
        updateTask('rc', { status: 'failed', error: String(err) });
      }

      // Advance after a brief pause so the user can see the final state
      await new Promise((r) => setTimeout(r, 1200));
      if (!cancelled) onNext({ installResults: tasksRef.current });
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
