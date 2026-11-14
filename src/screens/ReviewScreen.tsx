import * as fs from 'node:fs';
import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { NavHints } from '../components/NavHints.tsx';
import { WizardLayout } from '../components/WizardLayout.tsx';
import { uiColor } from '../config/colors.ts';
import { getShell, setupCommand } from '../config/shells.ts';
import { getSharedConfigPath, getShellConfigPath, plannedRcBlock } from '../generators/shellRc.ts';
import { generateToml } from '../generators/starship.ts';
import { fontLabel, plannedPathDir } from '../services/installer.ts';
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
function rcSnippet(
  shellId: ShellId,
  pointAtSharedConfig: boolean,
  pathDir: string | null
): string[] {
  const shell = getShell(shellId);
  if (!shell) return [];
  if (shell.rcFile) return plannedRcBlock(shellId, pointAtSharedConfig, pathDir);
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
  const [sharedConfigShadowed] = useState(
    () => !state.keepExistingConfig && fs.existsSync(getSharedConfigPath())
  );
  const [pathDir] = useState(() =>
    state.skipStarshipInstall ? null : plannedPathDir(state.packageManager)
  );

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
            : state.skipStarshipInstall
              ? 'Starship is skipped: the config below is written, but no shell is wired until Starship is installed. Use Esc to go back.'
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
          {state.keepExistingConfig ? (
            // Adopt mode: every shell reads the one shared config.
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

        {sharedConfigShadowed && (
          <Text color={uiColor('yellow')}>
            Your {getSharedConfigPath()} stays on disk (and is backed up), but these shells will
            read their own configs instead. To keep using it, run shell-configurator apply --adopt.
          </Text>
        )}

        <Box flexDirection="column" marginTop={1} gap={1}>
          <Text bold>Shell wiring</Text>
          {state.skipStarshipInstall && (
            <Text color={uiColor('gray')}>
              No rc file is changed until Starship is installed and the wizard is run again.
            </Text>
          )}
          {!state.skipStarshipInstall &&
            state.selectedShells.map((shellId) => {
              const shell = getShell(shellId);
              return (
                <Box key={shellId} flexDirection="column" marginLeft={1}>
                  <Text color={uiColor('cyan')}>
                    {shell?.label ?? shellId}
                    {shell?.rcFile ? ` — ${shell.rcFile}` : ''}
                  </Text>
                  {rcSnippet(shellId, state.keepExistingConfig, pathDir).map((line) => (
                    <Box key={line} marginLeft={2}>
                      <Text color={uiColor('yellow')}>{line}</Text>
                    </Box>
                  ))}
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
          { key: 'Enter', label: state.dryRun ? 'finish the dry run' : 'install' },
          { key: 'Esc', label: 'back' },
        ]}
      />
    </WizardLayout>
  );
}
