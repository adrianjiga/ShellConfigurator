import React, { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { WizardState } from '../types.js';
import { WizardLayout } from '../components/WizardLayout.js';
import { generateToml } from '../generators/starship.js';
import { writeStarshipConfig, applyShellConfig, getConfigPath } from '../generators/shellRc.js';
import { getShell } from '../config/shells.js';

interface DoneScreenProps {
  state: WizardState;
}

interface Result {
  configWritten: boolean;
  shellResults: { shellId: string; applied: boolean; note?: string }[];
  error?: string;
}

export function DoneScreen({ state }: DoneScreenProps) {
  const { exit } = useApp();
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    try {
      const toml = generateToml(state);
      writeStarshipConfig(toml);

      const shellResults = state.selectedShells.map((shellId) => {
        const res = applyShellConfig(shellId);
        return { shellId, ...res };
      });

      setResult({ configWritten: true, shellResults });
    } catch (err) {
      setResult({
        configWritten: false,
        shellResults: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  useInput((_, key) => {
    if (key.return || key.escape || _.toLowerCase() === 'q') {
      exit();
    }
  });

  if (!result) {
    return (
      <WizardLayout state={state} hidePreview>
        <Text color="yellow">Writing configuration...</Text>
      </WizardLayout>
    );
  }

  return (
    <WizardLayout state={state} hidePreview>
      <Box flexDirection="column" gap={1}>
        {result.error ? (
          <>
            <Text bold color="red">Something went wrong</Text>
            <Text color="red">{result.error}</Text>
          </>
        ) : (
          <>
            <Text bold color="green">All done!</Text>

            <Box flexDirection="column" marginTop={1} gap={1}>
              <Box flexDirection="row" gap={1}>
                <Text color="green">✓</Text>
                <Text>Starship config written to</Text>
                <Text color="cyan">{getConfigPath()}</Text>
              </Box>

              {result.shellResults.map(({ shellId, applied, note }) => {
                const shell = getShell(shellId as any);
                return (
                  <Box key={shellId} flexDirection="column">
                    <Box flexDirection="row" gap={1}>
                      <Text color={applied ? 'green' : 'yellow'}>
                        {applied ? '✓' : '⚠'}
                      </Text>
                      <Text>{shell?.label ?? shellId}:</Text>
                      {applied ? (
                        <Text color="gray">init line added to {shell?.rcFile}</Text>
                      ) : (
                        <Text color="yellow">{note ?? 'skipped'}</Text>
                      )}
                    </Box>
                    {!applied && shell?.manualNote && (
                      <Box marginLeft={4} flexDirection="column">
                        <Text color="gray">Add this to your shell config:</Text>
                        <Text color="cyan">{shell.initLine}</Text>
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Box>

            <Box marginTop={1} flexDirection="column">
              <Text color="gray">Restart your terminal to see the new prompt.</Text>
              <Text color="gray">
                Run <Text color="cyan">starship print-config</Text> to view the generated config.
              </Text>
            </Box>
          </>
        )}
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
