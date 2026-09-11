import { Box, Text, useInput } from 'ink';
import { NavHints } from '../components/NavHints.tsx';
import { WizardLayout } from '../components/WizardLayout.tsx';
import { getShell } from '../config/shells.ts';
import { getShellConfigPath, starshipConfigLine } from '../generators/shellRc.ts';
import { generateToml } from '../generators/starship.ts';
import { NERD_FONTS } from '../services/installer.ts';
import { buildTaskList, TASK_IDS } from '../services/installTasks.ts';
import { fontIdToInstall, type ShellId, type WizardState } from '../types.ts';

interface ReviewScreenProps {
  state: WizardState;
  onNext: (update?: Partial<WizardState>) => void;
  onBack: () => void;
}

/**
 * Preview of one shell's wiring: the STARSHIP_CONFIG export plus the init line
 * that get appended to its rc file, or the manual setup command for shells
 * without an rc file (nushell, powershell).
 */
function rcSnippet(shellId: ShellId): string[] {
  const shell = getShell(shellId);
  if (!shell) return [];
  const configLine = starshipConfigLine(shellId);
  if (configLine) return [configLine, shell.initLine];
  // Manual-only shells (nushell, powershell): the note plus the command to run.
  return shell.manualNote ? [shell.manualNote, shell.initLine] : [shell.initLine];
}

export function ReviewScreen({ state, onNext, onBack }: ReviewScreenProps) {
  const fontId = fontIdToInstall(state.nerdFontToInstall);
  const fontLabel = fontId ? (NERD_FONTS.find((f) => f.id === fontId)?.label ?? fontId) : null;
  const tasks = buildTaskList(state);

  useInput((char, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    // Space/Tab/Enter all confirm; there is nothing else to pick here.
    if (key.return || key.tab || char === ' ') {
      onNext();
      return;
    }
  });

  return (
    <WizardLayout state={state}>
      <Box flexDirection="column" gap={1}>
        <Text bold>Review your configuration</Text>
        <Text color="gray">
          {state.dryRun
            ? 'Running with --dry-run: nothing below will actually be installed or written.'
            : 'Everything below will be installed and written. Use Esc to go back and change things.'}
        </Text>

        <Box flexDirection="column" marginTop={1} gap={0}>
          <Text bold>This run will</Text>
          {tasks.map((task) => (
            <Box key={task.id} flexDirection="row" gap={1} marginLeft={1}>
              <Text color="cyan">•</Text>
              <Text color={task.id === TASK_IDS.config ? 'green' : 'gray'}>{task.label}</Text>
            </Box>
          ))}
        </Box>

        <Box flexDirection="column" marginTop={1} gap={1}>
          <Text bold>Configuration to write</Text>
          {state.selectedShells.map((shellId) => {
            const shell = getShell(shellId);
            const label = shell?.label ?? shellId;
            return (
              <Box key={shellId} flexDirection="column" marginLeft={1}>
                <Text color="cyan" bold>
                  {getShellConfigPath(shellId)} ({label})
                </Text>
                {rcSnippet(shellId).map((line) => (
                  <Box key={line} marginLeft={2}>
                    <Text color="yellow">{line}</Text>
                  </Box>
                ))}
                <Box marginLeft={2}>
                  <Text color="gray" dimColor>
                    {generateToml(state)}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>

        {fontId && (
          <Text color="gray">
            Nerd Font <Text color="cyan">{fontLabel}</Text> will be downloaded and installed.
          </Text>
        )}
      </Box>

      <NavHints
        hints={[
          { key: 'Enter / Space', label: 'install' },
          { key: 'Esc', label: 'back' },
        ]}
      />
    </WizardLayout>
  );
}
