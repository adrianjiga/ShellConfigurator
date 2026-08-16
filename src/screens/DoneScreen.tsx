import React from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { WizardState, InstallStatus, FONT_SELECT_SENTINEL } from '../types.js';
import { WizardLayout } from '../components/WizardLayout.js';
import { getConfigPath } from '../generators/shellRc.js';
import { getShell } from '../config/shells.js';
import { rcTaskId } from '../services/installTasks.js';
import { NERD_FONTS } from '../services/installer.js';

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
  const fontInstalled = state.nerdFontToInstall && state.nerdFontToInstall !== FONT_SELECT_SENTINEL;
  const fontLabel = fontInstalled
    ? (NERD_FONTS.find((f) => f.id === state.nerdFontToInstall)?.label ?? state.nerdFontToInstall)
    : null;

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

  const heading = noResults
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

        <Box flexDirection="column" marginTop={1} gap={1}>
          <Box flexDirection="column">
            <Box flexDirection="row" gap={1}>
              <StatusMark status={configStatus} />
              <Text>{configStatus === 'done' ? 'Config written to' : 'Config not written to'}</Text>
              <Text color="cyan">{getConfigPath()}</Text>
            </Box>
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

          {fontInstalled && (
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
                        ? (rcNote ?? 'skipped')
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
                {/* Shells with no rc file (nushell, powershell) need the init line run by hand */}
                {rcStatus === 'skipped' && !shell?.rcFile && shell?.initLine && (
                  <Box marginLeft={3}>
                    <Text color="cyan">{shell.initLine}</Text>
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
          <Text color="gray">Restart your terminal to see the new prompt.</Text>
          {state.skipStarshipInstall && (
            <Text color="yellow">
              Starship is not installed, so shell init lines were not added. Install it (e.g.{' '}
              <Text color="cyan">curl -sS https://starship.rs/install.sh | sh</Text>), then re-run
              the wizard to configure your shells.
            </Text>
          )}
          {fontInstalled && fontStatus === 'done' && (
            <Text color="yellow">
              Remember to set <Text color="cyan">{fontLabel} Nerd Font</Text> in your terminal
              emulator settings.
            </Text>
          )}
          <Text color="gray">
            Run <Text color="cyan">starship print-config</Text> to view the generated config.
          </Text>
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
