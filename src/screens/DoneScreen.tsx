import { Box, Text, useApp, useInput } from 'ink';
import { WizardLayout } from '../components/WizardLayout.tsx';
import { getShell } from '../config/shells.ts';
import { getShellConfigPath } from '../generators/shellRc.ts';
import { generateToml } from '../generators/starship.ts';
import { NERD_FONTS } from '../services/installer.ts';
import { buildTaskList, rcTaskId } from '../services/installTasks.ts';
import { fontIdToInstall, type InstallStatus, type WizardState } from '../types.ts';

interface DoneScreenProps {
  state: WizardState;
}

/** 'unknown' means no result was recorded — the task never ran, or the run was cut short. */
type ReportedStatus = InstallStatus | 'unknown';

/**
 * Never defaults a missing result to success: an absent task is reported as
 * 'unknown' so an interrupted run cannot render as an all-green summary.
 */
function taskStatus(state: WizardState, id: string): ReportedStatus {
  return state.installResults.find((t) => t.id === id)?.status ?? 'unknown';
}

function taskError(state: WizardState, id: string) {
  return state.installResults.find((t) => t.id === id)?.error;
}

function taskNote(state: WizardState, id: string) {
  return state.installResults.find((t) => t.id === id)?.note;
}

const STATUS_MARK: Record<ReportedStatus, { icon: string; color: string }> = {
  done: { icon: '✓', color: 'green' },
  skipped: { icon: '–', color: 'gray' },
  failed: { icon: '✗', color: 'red' },
  pending: { icon: '?', color: 'yellow' },
  running: { icon: '?', color: 'yellow' },
  unknown: { icon: '?', color: 'yellow' },
};

function StatusMark({ status }: { status: ReportedStatus }) {
  const { icon, color } = STATUS_MARK[status];
  return <Text color={color}>{icon}</Text>;
}

export function DoneScreen({ state }: DoneScreenProps) {
  const { exit } = useApp();
  const fontId = fontIdToInstall(state.nerdFontToInstall);
  const fontLabel = fontId ? (NERD_FONTS.find((f) => f.id === fontId)?.label ?? fontId) : null;

  const failures = state.installResults.filter((t) => t.status === 'failed');
  const hasFailures = failures.length > 0;
  const noResults = state.installResults.length === 0;

  useInput((char, key) => {
    if (key.return || key.escape || char.toLowerCase() === 'q') {
      exit();
    }
  });

  const configStatus = taskStatus(state, 'config');
  const fontStatus = taskStatus(state, 'font');
  const chshStatus = taskStatus(state, 'chsh');
  const chshOk = chshStatus === 'done';

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
              {[`Starship${fontId ? ` (${fontLabel})` : ''}`, ...state.selectedShells].join(', ')}{' '}
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
                <StatusMark status={configStatus} />
                <Text>
                  {configStatus === 'done' ? 'Per-shell config written' : 'Config not written'}
                </Text>
              </Box>
              {configStatus === 'done' &&
                state.selectedShells.map((shellId) => (
                  <Box key={shellId} marginLeft={3} flexDirection="row" gap={1}>
                    <Text color="cyan">{getShellConfigPath(shellId)}</Text>
                    <Text color="gray">(for {shellId})</Text>
                  </Box>
                ))}
              {configStatus === 'failed' && (
                <Box marginLeft={3}>
                  <Text color="red" italic>
                    {taskError(state, 'config')}
                  </Text>
                </Box>
              )}
              {taskNote(state, 'config') && (
                <Box marginLeft={3}>
                  <Text color="gray" italic>
                    {taskNote(state, 'config')}
                  </Text>
                </Box>
              )}
            </Box>
          )}

          {fontId && (
            <Box flexDirection="column">
              <Box flexDirection="row" gap={1}>
                <StatusMark status={fontStatus} />
                <Text>
                  Nerd Font {fontStatus === 'done' ? 'installed' : 'not installed'}:{' '}
                  <Text color="cyan">{fontLabel}</Text>
                </Text>
              </Box>
              {fontStatus === 'failed' && (
                <Box marginLeft={3}>
                  <Text color="red" italic>
                    {taskError(state, 'font')}
                  </Text>
                </Box>
              )}
            </Box>
          )}

          {state.selectedShells.map((shellId) => {
            const shell = getShell(shellId);
            const wasInstalled = state.installedShells.includes(shellId);
            const installStatus = taskStatus(state, `shell_${shellId}`);
            const installOk = wasInstalled || installStatus === 'done';
            // Each shell has its own rc task, so one shell failing no longer
            // marks the others as failed.
            const rcStatus = taskStatus(state, rcTaskId(shellId));
            const rcNote = taskNote(state, rcTaskId(shellId));
            return (
              <Box key={shellId} flexDirection="column">
                <Box flexDirection="row" gap={1}>
                  <StatusMark status={rcStatus} />
                  <Text>{shell?.label ?? shellId.charAt(0).toUpperCase() + shellId.slice(1)}:</Text>
                  {!wasInstalled && (
                    <Text color={installOk ? 'cyan' : 'red'}>
                      {installOk ? 'installed + ' : 'install failed'}
                    </Text>
                  )}
                  <Text color="gray">
                    {rcStatus === 'done'
                      ? `init line added to ${shell?.rcFile}`
                      : rcStatus === 'skipped'
                        ? shell?.rcFile
                          ? (rcNote ?? 'skipped')
                          : rcNote === 'already configured'
                            ? 'already configured'
                            : 'set up manually'
                        : rcStatus === 'failed'
                          ? 'not configured'
                          : 'status unknown'}
                  </Text>
                </Box>
                {installStatus === 'failed' && !wasInstalled && (
                  <Box marginLeft={3}>
                    <Text color="red" italic>
                      {taskError(state, `shell_${shellId}`)}
                    </Text>
                  </Box>
                )}
                {rcStatus === 'failed' && (
                  <Box marginLeft={3}>
                    <Text color="red" italic>
                      {taskError(state, rcTaskId(shellId))}
                    </Text>
                  </Box>
                )}
                {/* Manual-only shells (nushell, powershell) show the init command, unless it was already applied. */}
                {rcStatus === 'skipped' &&
                  !shell?.rcFile &&
                  shell?.initLine &&
                  rcNote !== 'already configured' && (
                    <Box marginLeft={3}>
                      <Text color="cyan">{shell.initLine}</Text>
                    </Box>
                  )}
                {(rcStatus === 'done' || (rcStatus === 'skipped' && !shell?.rcFile)) && rcNote && (
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
              <StatusMark status={chshStatus} />
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
              {fontId && fontStatus === 'done' && (
                <Text color="yellow">
                  Remember to set <Text color="cyan">{fontLabel} Nerd Font</Text> in your terminal
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
