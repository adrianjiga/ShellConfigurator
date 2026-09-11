import { Box, Text, useApp, useInput } from 'ink';
import { WizardLayout } from '../components/WizardLayout.tsx';
import { getShell } from '../config/shells.ts';
import { type ReportedStatus, statusMark } from '../config/status.ts';
import { getShellConfigPath } from '../generators/shellRc.ts';
import { generateToml } from '../generators/starship.ts';
import { fontLabel } from '../services/installer.ts';
import { buildTaskList, rcTaskId, TASK_IDS } from '../services/installTasks.ts';
import { fontIdToInstall, type InstallTask, type WizardState } from '../types.ts';

interface DoneScreenProps {
  state: WizardState;
}

/** One scan per task; callers read .status/.error/.note from the same result. */
function task(state: WizardState, id: string): InstallTask | undefined {
  return state.installResults.find((t) => t.id === id);
}

function StatusMark({ status }: { status: ReportedStatus }) {
  const { icon, color } = statusMark(status);
  return <Text color={color}>{icon}</Text>;
}

export function DoneScreen({ state }: DoneScreenProps) {
  const { exit } = useApp();
  const fontId = fontIdToInstall(state.nerdFontToInstall);
  const fontName = fontId ? fontLabel(fontId) : null;

  const failures = state.installResults.filter((t) => t.status === 'failed');
  const hasFailures = failures.length > 0;
  const noResults = state.installResults.length === 0;

  useInput((char, key) => {
    if (key.return || key.escape || char.toLowerCase() === 'q') {
      exit();
    }
  });

  const configTask = task(state, TASK_IDS.config);
  const fontTask = task(state, TASK_IDS.font);
  const chshTask = task(state, TASK_IDS.chsh);
  const chshOk = chshTask?.status === 'done';

  const heading = state.dryRun
    ? 'Dry run — no changes were made'
    : noResults
      ? 'Finished — no results recorded'
      : hasFailures
        ? 'Finished with errors'
        : 'All done!';

  return (
    <WizardLayout state={state} hidePreview>
      <Box flexDirection="column" gap={1}>
        <Text bold color={hasFailures || noResults ? 'yellow' : 'green'}>
          {heading}
        </Text>

        {noResults && (
          <Text color="yellow">
            The install step reported nothing back, so none of the steps below are confirmed. Re-run
            the wizard to verify.
          </Text>
        )}

        {state.dryRun && (
          <>
            <Text color="yellow" italic>
              In real mode the wizard would install{' '}
              {[`Starship${fontId ? ` (${fontName})` : ''}`, ...state.selectedShells].join(', ')}{' '}
              and write the config below.
            </Text>

            <Box marginTop={1} flexDirection="column" gap={1}>
              <Text bold>Tasks that would run</Text>
              {buildTaskList(state).map((task) => (
                <Box key={task.id} flexDirection="row" gap={1}>
                  <Text color="gray">would-run</Text>
                  <Text color="gray">{task.label}</Text>
                </Box>
              ))}
            </Box>

            <Box marginTop={1} flexDirection="column" gap={1}>
              <Text bold>Generated config</Text>
              {state.selectedShells.map((shellId) => (
                <Box key={shellId} flexDirection="column">
                  <Text color="cyan">{getShellConfigPath(shellId)}</Text>
                  <Box marginLeft={2}>
                    <Text color="gray" dimColor>
                      {generateToml(state)}
                    </Text>
                  </Box>
                </Box>
              ))}
            </Box>
          </>
        )}

        <Box flexDirection="column" marginTop={1} gap={1}>
          {!state.dryRun && (
            <Box flexDirection="column">
              <Box flexDirection="row" gap={1}>
                <StatusMark status={configTask?.status ?? 'unknown'} />
                <Text>
                  {configTask?.status === 'done'
                    ? 'Per-shell config written'
                    : 'Config not written'}
                </Text>
              </Box>
              {configTask?.status === 'done' &&
                state.selectedShells.map((shellId) => (
                  <Box key={shellId} marginLeft={3} flexDirection="row" gap={1}>
                    <Text color="cyan">{getShellConfigPath(shellId)}</Text>
                    <Text color="gray">(for {shellId})</Text>
                  </Box>
                ))}
              {configTask?.status === 'failed' && (
                <Box marginLeft={3}>
                  <Text color="red" italic>
                    {configTask.error}
                  </Text>
                </Box>
              )}
              {configTask?.note && (
                <Box marginLeft={3}>
                  <Text color="gray" italic>
                    {configTask.note}
                  </Text>
                </Box>
              )}
            </Box>
          )}

          {fontId && (
            <Box flexDirection="column">
              <Box flexDirection="row" gap={1}>
                <StatusMark status={fontTask?.status ?? 'unknown'} />
                <Text>
                  Nerd Font {fontTask?.status === 'done' ? 'installed' : 'not installed'}:{' '}
                  <Text color="cyan">{fontName}</Text>
                </Text>
              </Box>
              {fontTask?.status === 'failed' && (
                <Box marginLeft={3}>
                  <Text color="red" italic>
                    {fontTask.error}
                  </Text>
                </Box>
              )}
            </Box>
          )}

          {state.selectedShells.map((shellId) => {
            const shell = getShell(shellId);
            const wasInstalled = state.installedShells.includes(shellId);
            const installTask = task(state, `shell_${shellId}`);
            const installOk = wasInstalled || installTask?.status === 'done';
            // Each shell has its own rc task, so one shell failing no longer
            // marks the others as failed.
            const rcTask = task(state, rcTaskId(shellId));
            const rcNote = rcTask?.note;
            return (
              <Box key={shellId} flexDirection="column">
                <Box flexDirection="row" gap={1}>
                  <StatusMark status={rcTask?.status ?? 'unknown'} />
                  <Text>{shell?.label ?? shellId.charAt(0).toUpperCase() + shellId.slice(1)}:</Text>
                  {!wasInstalled && (
                    <Text color={installOk ? 'cyan' : 'red'}>
                      {installOk ? 'installed + ' : 'install failed'}
                    </Text>
                  )}
                  <Text color="gray">
                    {rcTask?.status === 'done'
                      ? `init line added to ${shell?.rcFile}`
                      : rcTask?.status === 'skipped'
                        ? shell?.rcFile
                          ? (rcNote ?? 'skipped')
                          : rcNote === 'already configured'
                            ? 'already configured'
                            : 'set up manually'
                        : rcTask?.status === 'failed'
                          ? 'not configured'
                          : 'status unknown'}
                  </Text>
                </Box>
                {installTask?.status === 'failed' && !wasInstalled && (
                  <Box marginLeft={3}>
                    <Text color="red" italic>
                      {installTask.error}
                    </Text>
                  </Box>
                )}
                {rcTask?.status === 'failed' && (
                  <Box marginLeft={3}>
                    <Text color="red" italic>
                      {rcTask.error}
                    </Text>
                  </Box>
                )}
                {/* Manual-only shells (nushell, powershell) show the init command, unless it was already applied. */}
                {rcTask?.status === 'skipped' &&
                  !shell?.rcFile &&
                  shell?.initLine &&
                  rcNote !== 'already configured' && (
                    <Box marginLeft={3}>
                      <Text color="cyan">{shell.initLine}</Text>
                    </Box>
                  )}
                {(rcTask?.status === 'done' || (rcTask?.status === 'skipped' && !shell?.rcFile)) &&
                  rcNote && (
                    <Box marginLeft={3}>
                      <Text color="gray" italic>
                        {rcNote}
                      </Text>
                    </Box>
                  )}
              </Box>
            );
          })}

          {state.setDefaultShell && (
            <Box flexDirection="row" gap={1}>
              <StatusMark status={chshTask?.status ?? 'unknown'} />
              <Text>
                Default shell {chshOk ? 'set to' : 'not set to'}{' '}
                <Text color="cyan">{state.setDefaultShell}</Text>
              </Text>
            </Box>
          )}
        </Box>

        <Box marginTop={1} flexDirection="column">
          {state.dryRun ? (
            <>
              <Text color="gray">
                Run without <Text color="cyan">--dry-run</Text> to apply these changes.
              </Text>
              <Text color="gray">
                Run <Text color="cyan">starship print-config</Text> to view the generated config.
              </Text>
            </>
          ) : (
            <>
              <Text color="gray">Restart your terminal to see the new prompt.</Text>
              {state.skipStarshipInstall && (
                <Text color="yellow">
                  Starship is not installed, so shell init lines were not added. Install it (e.g.{' '}
                  <Text color="cyan">curl -sS https://starship.rs/install.sh | sh</Text>), then
                  re-run the wizard to configure your shells.
                </Text>
              )}
              {fontId && fontTask?.status === 'done' && (
                <Text color="yellow">
                  Remember to set <Text color="cyan">{fontName} Nerd Font</Text> in your terminal
                  emulator settings.
                </Text>
              )}
              <Text color="gray">
                Run <Text color="cyan">starship print-config</Text> to view the generated config.
              </Text>
            </>
          )}
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color="gray">Press </Text>
        <Text color="cyan">q</Text>
        <Text color="gray"> or </Text>
        <Text color="cyan">Enter</Text>
        <Text color="gray"> to exit.</Text>
      </Box>
    </WizardLayout>
  );
}
