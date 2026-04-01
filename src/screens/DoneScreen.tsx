import React from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { WizardState, FONT_SELECT_SENTINEL } from '../types.js';
import { WizardLayout } from '../components/WizardLayout.js';
import { getConfigPath } from '../generators/shellRc.js';
import { getShell } from '../config/shells.js';
import { NERD_FONTS } from '../services/installer.js';

interface DoneScreenProps {
  state: WizardState;
}

function taskStatus(state: WizardState, id: string) {
  const task = state.installResults.find((t) => t.id === id);
  return task?.status ?? 'done';
}

function taskError(state: WizardState, id: string) {
  return state.installResults.find((t) => t.id === id)?.error;
}

export function DoneScreen({ state }: DoneScreenProps) {
  const { exit } = useApp();
  const fontInstalled = state.nerdFontToInstall && state.nerdFontToInstall !== FONT_SELECT_SENTINEL;
  const fontLabel = fontInstalled
    ? (NERD_FONTS.find((f) => f.id === state.nerdFontToInstall)?.label ?? state.nerdFontToInstall)
    : null;

  const failures = state.installResults.filter((t) => t.status === 'failed');
  const hasFailures = failures.length > 0;

  useInput((char, key) => {
    if (key.return || key.escape || char.toLowerCase() === 'q') {
      exit();
    }
  });

  const configOk = taskStatus(state, 'config') !== 'failed';
  const fontOk = taskStatus(state, 'font') !== 'failed';
  const rcOk = taskStatus(state, 'rc') !== 'failed';

  return (
    <WizardLayout state={state} hidePreview>
      <Box flexDirection="column" gap={1}>
        <Text bold color={hasFailures ? 'yellow' : 'green'}>
          {hasFailures ? 'Finished with errors' : 'All done!'}
        </Text>

        <Box flexDirection="column" marginTop={1} gap={1}>
          <Box flexDirection="column">
            <Box flexDirection="row" gap={1}>
              <Text color={configOk ? 'green' : 'red'}>{configOk ? '✓' : '✗'}</Text>
              <Text>Config written to</Text>
              <Text color="cyan">{getConfigPath()}</Text>
            </Box>
            {!configOk && (
              <Box marginLeft={3}>
                <Text color="red" italic>
                  {taskError(state, 'config')}
                </Text>
              </Box>
            )}
          </Box>

          {fontInstalled && (
            <Box flexDirection="column">
              <Box flexDirection="row" gap={1}>
                <Text color={fontOk ? 'green' : 'red'}>{fontOk ? '✓' : '✗'}</Text>
                <Text>
                  Nerd Font {fontOk ? 'installed' : 'failed'}: <Text color="cyan">{fontLabel}</Text>
                </Text>
              </Box>
              {!fontOk && (
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
            const shellOk = taskStatus(state, `shell_${shellId}`) !== 'failed';
            return (
              <Box key={shellId} flexDirection="column">
                <Box flexDirection="row" gap={1}>
                  <Text color={rcOk ? 'green' : 'red'}>{rcOk ? '✓' : '✗'}</Text>
                  <Text>{shell?.label ?? shellId.charAt(0).toUpperCase() + shellId.slice(1)}:</Text>
                  {!wasInstalled && (
                    <Text color={shellOk ? 'cyan' : 'red'}>
                      {shellOk ? 'installed + ' : 'install failed'}
                    </Text>
                  )}
                  {(wasInstalled || shellOk) && (
                    <Text color="gray">
                      {shell?.rcFile ? `init line added to ${shell.rcFile}` : shell?.manualNote}
                    </Text>
                  )}
                </Box>
                {!shellOk && !wasInstalled && (
                  <Box marginLeft={3}>
                    <Text color="red" italic>
                      {taskError(state, `shell_${shellId}`)}
                    </Text>
                  </Box>
                )}
              </Box>
            );
          })}

          {state.setDefaultShell && (
            <Box flexDirection="row" gap={1}>
              <Text color={taskStatus(state, 'chsh') !== 'failed' ? 'green' : 'red'}>
                {taskStatus(state, 'chsh') !== 'failed' ? '✓' : '✗'}
              </Text>
              <Text>
                Default shell {taskStatus(state, 'chsh') !== 'failed' ? 'set to' : 'failed to set'}{' '}
                <Text color="cyan">{state.setDefaultShell}</Text>
              </Text>
            </Box>
          )}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text color="gray">Restart your terminal to see the new prompt.</Text>
          {fontInstalled && fontOk && (
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
