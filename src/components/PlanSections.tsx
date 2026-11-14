import { Box, Text } from 'ink';
import { uiColor } from '../config/colors.ts';
import { getShell } from '../config/shells.ts';
import { getSharedConfigPath, getShellConfigPath } from '../generators/shellRc.ts';
import { generateToml } from '../generators/starship.ts';
import { TASK_IDS } from '../services/installTasks.ts';
import type { InstallTask, WizardState } from '../types.ts';

export function TaskPlan({ title, tasks }: { title: string; tasks: InstallTask[] }) {
  return (
    <Box flexDirection="column" marginTop={1} gap={0}>
      <Text bold>{title}</Text>
      {tasks.map((task) => (
        <Box key={task.id} flexDirection="row" gap={1} marginLeft={1}>
          <Text color={uiColor('cyan')}>•</Text>
          <Text color={uiColor(task.id === TASK_IDS.config ? 'green' : 'gray')}>{task.label}</Text>
        </Box>
      ))}
    </Box>
  );
}

/** The config a run writes, or in adopt mode the shared config it keeps. */
export function ConfigPlan({ state }: { state: WizardState }) {
  return (
    <Box flexDirection="column" marginTop={1} gap={1}>
      <Text bold>{state.keepExistingConfig ? 'Config to keep' : 'Configuration to write'}</Text>
      {state.keepExistingConfig ? (
        <Box flexDirection="column" marginLeft={1}>
          <Text color={uiColor('cyan')} bold>
            {getSharedConfigPath()} (shared by every shell)
          </Text>
          <Box marginLeft={2}>
            {state.sharedConfigToml ? (
              <Text color={uiColor('gray')} dimColor>
                {state.sharedConfigToml}
              </Text>
            ) : (
              <Text color={uiColor('gray')}>The existing config will be kept as-is.</Text>
            )}
          </Box>
        </Box>
      ) : (
        // The same TOML goes to every shell's file, so it is shown once.
        <Box flexDirection="column" marginLeft={1}>
          {state.selectedShells.map((shellId) => (
            <Text key={shellId} color={uiColor('cyan')} bold>
              {getShellConfigPath(shellId)} ({getShell(shellId)?.label ?? shellId})
            </Text>
          ))}
          <Box marginLeft={2}>
            <Text color={uiColor('gray')} dimColor>
              {generateToml(state)}
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
