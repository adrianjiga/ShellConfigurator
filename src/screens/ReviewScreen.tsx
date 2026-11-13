import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { NavHints } from '../components/NavHints.tsx';
import { WizardLayout } from '../components/WizardLayout.tsx';
import { uiColor } from '../config/colors.ts';
import { getShell, setupCommand } from '../config/shells.ts';
import {
  ADOPT_MARKER,
  getSharedConfigPath,
  getShellConfigPath,
  starshipConfigLine,
} from '../generators/shellRc.ts';
import { generateToml } from '../generators/starship.ts';
import { fontLabel } from '../services/installer.ts';
import { buildTaskList, plannedResetShells, TASK_IDS } from '../services/installTasks.ts';
import { fontIdToInstall, type ShellId, type WizardState } from '../types.ts';

interface ReviewScreenProps {
  state: WizardState;
  onNext: (update?: Partial<WizardState>) => void;
  onBack: () => void;
}

/**
 * Preview of one shell's wiring: the STARSHIP_CONFIG export plus the init line
 * that get appended to its rc file, or the manual setup command for shells
 * without an rc file (nushell, powershell). In adopt mode no export is added —
 * the shell reads the shared starship.toml — so only the init line is shown.
 */
function rcSnippet(shellId: ShellId, pointAtSharedConfig: boolean): string[] {
  const shell = getShell(shellId);
  if (!shell) return [];
  const configLine = pointAtSharedConfig ? null : starshipConfigLine(shellId);
  if (configLine) return [configLine, shell.initLine];
  // Manual-only shells (nushell, powershell): the note plus the command to run,
  // or adopt mode where the shared config needs no export.
  const command = setupCommand(shell, pointAtSharedConfig);
  // The note refers to "the command above", so it follows the command.
  return shell.manualNote ? [command, shell.manualNote] : [command];
}

export function ReviewScreen({ state, onNext, onBack }: ReviewScreenProps) {
  const fontId = fontIdToInstall(state.nerdFontToInstall);
  const fontName = fontId ? fontLabel(fontId) : null;
  const [tasks] = useState(() => buildTaskList(state, plannedResetShells(state)));

  useInput((_char, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    // Only Enter starts the run: a stray Space or Tab must not.
    if (key.return) {
      onNext();
      return;
    }
  });

  return (
    <WizardLayout state={state}>
      <Box flexDirection="column" gap={1}>
        <Text bold>Review your configuration</Text>
        <Text color={uiColor('gray')}>
          {state.dryRun
            ? 'Running with --dry-run: nothing below will actually be installed or written.'
            : 'Everything below will be installed and written. Use Esc to go back and change things.'}
        </Text>

        <Box flexDirection="column" marginTop={1} gap={0}>
          <Text bold>This run will</Text>
          {tasks.map((task) => (
            <Box key={task.id} flexDirection="row" gap={1} marginLeft={1}>
              <Text color={uiColor('cyan')}>•</Text>
              <Text color={uiColor(task.id === TASK_IDS.config ? 'green' : 'gray')}>
                {task.label}
              </Text>
            </Box>
          ))}
        </Box>

        <Box flexDirection="column" marginTop={1} gap={1}>
          <Text bold>{state.keepExistingConfig ? 'Config to keep' : 'Configuration to write'}</Text>
          {state.selectedShells.map((shellId) => {
            const shell = getShell(shellId);
            const label = shell?.label ?? shellId;
            if (state.keepExistingConfig) {
              // Adopt mode: every shell reads the shared config, so the preview
              // shows that file and the rc wiring — never a generated per-shell TOML.
              return (
                <Box key={shellId} flexDirection="column" marginLeft={1}>
                  <Text color={uiColor('cyan')} bold>
                    {getSharedConfigPath()} (shared)
                  </Text>
                  <Box marginLeft={2}>
                    <Text color={uiColor('yellow')}>{ADOPT_MARKER}</Text>
                  </Box>
                  {rcSnippet(shellId, true).map((line) => (
                    <Box key={line} marginLeft={2}>
                      <Text color={uiColor('yellow')}>{line}</Text>
                    </Box>
                  ))}
                  <Box marginLeft={2}>
                    {state.sharedConfigToml ? (
                      <Text color={uiColor('gray')} dimColor>
                        {state.sharedConfigToml}
                      </Text>
                    ) : (
                      <Text color={uiColor('gray')}>
                        The existing config above will be kept as-is.
                      </Text>
                    )}
                  </Box>
                </Box>
              );
            }
            return (
              <Box key={shellId} flexDirection="column" marginLeft={1}>
                <Text color={uiColor('cyan')} bold>
                  {getShellConfigPath(shellId)} ({label})
                </Text>
                {rcSnippet(shellId, false).map((line) => (
                  <Box key={line} marginLeft={2}>
                    <Text color={uiColor('yellow')}>{line}</Text>
                  </Box>
                ))}
                <Box marginLeft={2}>
                  <Text color={uiColor('gray')} dimColor>
                    {generateToml(state)}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>

        {fontId && (
          <Text color={uiColor('gray')}>
            Nerd Font <Text color={uiColor('cyan')}>{fontName}</Text> will be downloaded and
            installed.
          </Text>
        )}
      </Box>

      <NavHints
        hints={[
          { key: 'Enter', label: 'install' },
          { key: 'Esc', label: 'back' },
        ]}
      />
    </WizardLayout>
  );
}
