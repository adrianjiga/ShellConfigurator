import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { execSync } from 'child_process';
import { WizardState } from '../types.js';
import { WizardLayout } from '../components/WizardLayout.js';
import { NavHints } from '../components/NavHints.js';

interface WelcomeScreenProps {
  state: WizardState;
  onNext: (update: Partial<WizardState>) => void;
}

function checkStarship(): { installed: boolean; version?: string } {
  try {
    const version = execSync('starship --version', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return { installed: true, version };
  } catch {
    return { installed: false };
  }
}

export function WelcomeScreen({ state, onNext }: WelcomeScreenProps) {
  const [status, setStatus] = useState<{ installed: boolean; version?: string } | null>(null);

  useEffect(() => {
    setStatus(checkStarship());
  }, []);

  useInput((_, key) => {
    if (key.return && status?.installed) {
      onNext({ starshipInstalled: true });
    }
  });

  return (
    <WizardLayout state={state} hidePreview>
      <Box flexDirection="column" gap={1}>
        <Text bold color="cyan">
          Welcome to ShellConfigurator
        </Text>
        <Text color="gray">
          An interactive wizard for setting up your{' '}
          <Text color="cyan" bold>Starship</Text>
          {' '}cross-shell prompt.
        </Text>
        <Text color="gray">
          Works with zsh, bash, fish, nushell, and powershell.
        </Text>

        <Box marginTop={1} flexDirection="column">
          {status === null ? (
            <Text color="yellow">Checking for Starship...</Text>
          ) : status.installed ? (
            <Box flexDirection="column">
              <Text color="green">✓ Starship is installed</Text>
              {status.version && (
                <Text color="gray">  {status.version}</Text>
              )}
            </Box>
          ) : (
            <Box flexDirection="column" gap={1}>
              <Text color="red">✗ Starship is not installed</Text>
              <Text color="yellow">Install it first, then re-run this wizard:</Text>
              <Box
                borderStyle="round"
                borderColor="gray"
                paddingX={2}
                paddingY={1}
                flexDirection="column"
                gap={1}
              >
                <Text color="gray"># Linux/macOS (curl)</Text>
                <Text>curl -sS https://starship.rs/install.sh | sh</Text>
                <Text color="gray"># Homebrew</Text>
                <Text>brew install starship</Text>
                <Text color="gray"># Arch Linux</Text>
                <Text>pacman -S starship</Text>
              </Box>
            </Box>
          )}
        </Box>
      </Box>

      {status?.installed && (
        <NavHints hints={[{ key: 'Enter', label: 'continue' }]} />
      )}
    </WizardLayout>
  );
}
