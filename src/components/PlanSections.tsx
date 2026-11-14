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

export const CONFIG_PREVIEW_LINES = 8;

/** The first lines of `toml`, and a line saying how many more there are. */
function FoldedToml({ toml, expanded }: { toml: string; expanded: boolean }) {
  const lines = toml.trimEnd().split('\n');
  const hidden = expanded ? 0 : Math.max(0, lines.length - CONFIG_PREVIEW_LINES);
  return (
    <Box flexDirection="column">
      <Text color={uiColor('gray')} dimColor>
        {(hidden > 0 ? lines.slice(0, CONFIG_PREVIEW_LINES) : lines).join('\n')}
      </Text>
      {hidden > 0 && (
        <Text color={uiColor('gray')} italic>
          … {hidden} more lines (press t to show them)
        </Text>
      )}
    </Box>
  );
}

/** The config a run writes, or in adopt mode the shared config it keeps. */
export function ConfigPlan({ state, expanded = true }: { state: WizardState; expanded?: boolean }) {
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
              <FoldedToml toml={state.sharedConfigToml} expanded={expanded} />
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
            <FoldedToml toml={generateToml(state)} expanded={expanded} />
          </Box>
        </Box>
      )}
    </Box>
  );
}
