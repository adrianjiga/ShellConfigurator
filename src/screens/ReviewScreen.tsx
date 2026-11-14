import * as fs from 'node:fs';
import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { NavHints } from '../components/NavHints.tsx';
import { ConfigPlan, TaskPlan } from '../components/PlanSections.tsx';
import { WizardLayout } from '../components/WizardLayout.tsx';
import { uiColor } from '../config/colors.ts';
import { getShell, setupCommand } from '../config/shells.ts';
import { getSharedConfigPath } from '../generators/shellRc.ts';
import { diffHunkLines, type FileChange, plannedFileChanges } from '../services/fileDiff.ts';
import { fontLabel, plannedPathDir } from '../services/installer.ts';
import { buildTaskList, plannedFont, plannedResetShells } from '../services/installTasks.ts';
import { redactHome } from '../services/paths.ts';
import type { ShellId, WizardState } from '../types.ts';

interface ReviewScreenProps {
  state: WizardState;
  onNext: (update?: Partial<WizardState>) => void;
  onBack: () => void;
}

/** The setup command a shell without an rc file (nushell, powershell) needs, then its note. */
function manualSetup(shellId: ShellId, pointAtSharedConfig: boolean): string[] {
  const shell = getShell(shellId);
  if (!shell) return [];
  const command = setupCommand(shell, pointAtSharedConfig);
  // The note refers to "the command above", so it follows the command.
  return shell.manualNote ? [command, shell.manualNote] : [command];
}

function diffLineColor(line: string): string | undefined {
  if (line.startsWith('@@')) return uiColor('gray');
  if (line.startsWith('+')) return uiColor('green');
  if (line.startsWith('-')) return uiColor('red');
  return undefined;
}

function changeSummary(change: FileChange): string {
  const file = redactHome(change.path);
  if (change.status === 'unreadable') return `cannot read ${file}: ${change.error}`;
  const counts = `+${change.added} -${change.removed}`;
  return `${change.status === 'create' ? 'create' : 'edit  '} ${file} (${counts})`;
}

function RcWiring({ change }: { change: FileChange | undefined }) {
  if (!change) {
    return (
      <Box marginLeft={2}>
        <Text color={uiColor('gray')}>already set up: the file stays as it is</Text>
      </Box>
    );
  }
  if (change.status === 'unreadable') {
    return (
      <Box marginLeft={2}>
        <Text color={uiColor('yellow')}>cannot read it: {change.error}</Text>
      </Box>
    );
  }
  const lines = diffHunkLines(change.diff).map((text, position) => ({ text, position }));
  return (
    <Box flexDirection="column" marginLeft={2}>
      {lines.map((line) => (
        <Text key={line.position} color={diffLineColor(line.text)}>
          {line.text}
        </Text>
      ))}
    </Box>
  );
}

export function ReviewScreen({ state, onNext, onBack }: ReviewScreenProps) {
  const fontId = plannedFont(state);
  const fontName = fontId ? fontLabel(fontId) : null;
  const [resetShells] = useState(() => plannedResetShells(state));
  const [tasks] = useState(() => buildTaskList(state, resetShells));
  const [sharedConfigShadowed] = useState(
    () => !state.keepExistingConfig && fs.existsSync(getSharedConfigPath())
  );
  const [changes] = useState(() =>
    plannedFileChanges(
      state,
      resetShells,
      state.skipStarshipInstall ? null : plannedPathDir(state.packageManager)
    )
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

        <TaskPlan title="This run will" tasks={tasks} />
        <ConfigPlan state={state} />

        {sharedConfigShadowed && (
          <Text color={uiColor('yellow')}>
            Your {getSharedConfigPath()} stays on disk (and is backed up), but these shells will
            read their own configs instead. To keep using it, run shell-configurator apply --adopt.
          </Text>
        )}

        <Box flexDirection="column" marginTop={1}>
          <Text bold>Config and rc files</Text>
          {changes.length === 0 ? (
            <Box marginLeft={1}>
              <Text color={uiColor('gray')}>No config or rc file changes.</Text>
            </Box>
          ) : (
            changes.map((change) => (
              <Box key={change.path} marginLeft={1}>
                <Text color={change.status === 'unreadable' ? uiColor('yellow') : undefined}>
                  {changeSummary(change)}
                </Text>
              </Box>
            ))
          )}
        </Box>

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
                  {shell?.rcFile ? (
                    <RcWiring change={changes.find((change) => change.path === shell.rcFile)} />
                  ) : (
                    manualSetup(shellId, state.keepExistingConfig).map((line) => (
                      <Box key={line} marginLeft={2}>
                        <Text color={uiColor('yellow')}>{line}</Text>
                      </Box>
                    ))
                  )}
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
