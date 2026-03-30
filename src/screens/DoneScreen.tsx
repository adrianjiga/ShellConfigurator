import React from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { WizardState } from '../types.js';
import { WizardLayout } from '../components/WizardLayout.js';
import { getConfigPath } from '../generators/shellRc.js';
import { getShell } from '../config/shells.js';

interface DoneScreenProps {
  state: WizardState;
}

export function DoneScreen({ state }: DoneScreenProps) {
  const { exit } = useApp();

  useInput((char, key) => {
    if (key.return || key.escape || char.toLowerCase() === 'q') {
      exit();
    }
  });

  return (
    <WizardLayout state={state} hidePreview>
      <Box flexDirection="column" gap={1}>
        <Text bold color="green">
          All done!
        </Text>

        <Box flexDirection="column" marginTop={1} gap={1}>
          <Box flexDirection="row" gap={1}>
            <Text color="green">✓</Text>
            <Text>Config written to</Text>
            <Text color="cyan">{getConfigPath()}</Text>
          </Box>

          {state.nerdFontToInstall && (
            <Box flexDirection="row" gap={1}>
              <Text color="green">✓</Text>
              <Text>
                Nerd Font installed: <Text color="cyan">{state.nerdFontToInstall}</Text>
              </Text>
            </Box>
          )}

          {state.selectedShells.map((shellId) => {
            const shell = getShell(shellId);
            const wasInstalled = state.installedShells.includes(shellId);
            return (
              <Box key={shellId} flexDirection="row" gap={1}>
                <Text color="green">✓</Text>
                <Text>{shell?.label ?? shellId}:</Text>
                {!wasInstalled && <Text color="cyan">installed + </Text>}
                <Text color="gray">
                  {shell?.rcFile ? `init line added to ${shell.rcFile}` : shell?.manualNote}
                </Text>
              </Box>
            );
          })}

          {state.setDefaultShell && (
            <Box flexDirection="row" gap={1}>
              <Text color="green">✓</Text>
              <Text>
                Default shell set to <Text color="cyan">{state.setDefaultShell}</Text>
              </Text>
            </Box>
          )}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text color="gray">Restart your terminal to see the new prompt.</Text>
          {state.nerdFontToInstall && (
            <Text color="yellow">
              Remember to set <Text color="cyan">{state.nerdFontToInstall} Nerd Font</Text> in your
              terminal emulator settings.
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
