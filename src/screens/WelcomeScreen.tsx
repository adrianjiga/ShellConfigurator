import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { WizardState, PackageManager } from '../types.js';
import { detectPackageManager, isStarshipInstalled } from '../services/detector.js';
import { WizardLayout } from '../components/WizardLayout.js';
import { NavHints } from '../components/NavHints.js';

interface WelcomeScreenProps {
  state: WizardState;
  onNext: (update: Partial<WizardState>) => void;
}

interface Detection {
  starship: { installed: boolean; version?: string };
  pm: PackageManager;
}

const PM_LABELS: Record<PackageManager, string> = {
  pacman: 'pacman (Arch)',
  apt: 'apt (Debian/Ubuntu)',
  dnf: 'dnf (Fedora)',
  brew: 'Homebrew (macOS)',
  curl: 'curl (no package manager detected)',
};

export function WelcomeScreen({ state, onNext }: WelcomeScreenProps) {
  const [detection, setDetection] = useState<Detection | null>(null);

  useEffect(() => {
    const pm = detectPackageManager();
    const starship = isStarshipInstalled();
    setDetection({ pm, starship });
  }, []);

  useInput((_, key) => {
    if (key.return && detection?.starship.installed) {
      onNext({
        starshipInstalled: true,
        packageManager: detection.pm,
      });
    }
  });

  const installItems = [
    { label: 'Install automatically', value: 'auto' },
    { label: "I'll install it manually", value: 'manual' },
  ];

  function handleInstallChoice(item: { value: string }) {
    if (!detection) return;
    if (item.value === 'auto') {
      // Mark not installed — InstallingScreen will handle it
      onNext({ starshipInstalled: false, packageManager: detection.pm });
    }
    // 'manual' — stay on screen, show instructions
  }

  return (
    <WizardLayout state={state} hidePreview>
      <Box flexDirection="column" gap={1}>
        <Text bold color="cyan">
          Welcome to ShellConfigurator
        </Text>
        <Text color="gray">
          An interactive wizard for setting up your{' '}
          <Text color="cyan" bold>
            Starship
          </Text>{' '}
          cross-shell prompt.
        </Text>
        <Text color="gray">Works with zsh, bash, fish, nushell, and powershell.</Text>

        <Box marginTop={1} flexDirection="column" gap={1}>
          {detection === null ? (
            <Text color="yellow">Detecting system...</Text>
          ) : (
            <>
              <Box flexDirection="row" gap={1}>
                <Text color="gray">Package manager:</Text>
                <Text color="cyan">{PM_LABELS[detection.pm]}</Text>
              </Box>

              {detection.starship.installed ? (
                <Box flexDirection="column">
                  <Text color="green">✓ Starship is installed</Text>
                  {detection.starship.version && (
                    <Text color="gray"> {detection.starship.version}</Text>
                  )}
                </Box>
              ) : (
                <Box flexDirection="column" gap={1}>
                  <Text color="yellow">✗ Starship is not installed</Text>
                  <SelectInput items={installItems} onSelect={handleInstallChoice} />
                </Box>
              )}
            </>
          )}
        </Box>
      </Box>

      {detection?.starship.installed && <NavHints hints={[{ key: 'Enter', label: 'continue' }]} />}
    </WizardLayout>
  );
}
