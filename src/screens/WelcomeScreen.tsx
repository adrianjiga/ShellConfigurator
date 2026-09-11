import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { useCallback, useEffect, useState } from 'react';
import { NavHints } from '../components/NavHints.tsx';
import { WizardLayout } from '../components/WizardLayout.tsx';
import { detectPackageManagerAsync, isStarshipInstalledAsync } from '../services/detector.ts';
import type { PackageManager, WizardState } from '../types.ts';

interface WelcomeScreenProps {
  state: WizardState;
  onNext: (update: Partial<WizardState>) => void;
}

interface Detection {
  starship: { installed: boolean; version?: string };
  pm: PackageManager;
}

type InstallChoice = 'auto' | 'manual';
type ManualChoice = 'recheck' | 'continue';
type Item<V> = { label: string; value: V };

const PM_LABELS: Record<PackageManager, string> = {
  pacman: 'pacman (Arch)',
  apt: 'apt (Debian/Ubuntu)',
  dnf: 'dnf (Fedora)',
  brew: 'Homebrew (macOS)',
  apk: 'apk (Alpine)',
  script: 'install script (no package manager detected)',
};

export function WelcomeScreen({ state, onNext }: WelcomeScreenProps) {
  const [detection, setDetection] = useState<Detection | null>(null);
  const [showManualHelp, setShowManualHelp] = useState(false);

  const runDetection = useCallback(async (shouldDrop: () => boolean = () => false) => {
    const [pm, starship] = await Promise.all([
      detectPackageManagerAsync(),
      isStarshipInstalledAsync(),
    ]);
    if (!shouldDrop()) setDetection({ pm, starship });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void runDetection(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [runDetection]);

  useInput((_, key) => {
    if (key.return && detection?.starship.installed) {
      onNext({
        starshipInstalled: true,
        packageManager: detection.pm,
      });
    }
  });

  const installItems: Item<InstallChoice>[] = [
    { label: 'Install automatically', value: 'auto' },
    { label: "I'll install it manually", value: 'manual' },
  ];

  const manualItems: Item<ManualChoice>[] = [
    { label: 'Re-check (I installed it)', value: 'recheck' },
    { label: 'Continue without Starship', value: 'continue' },
  ];

  function handleInstallChoice(item: Item<InstallChoice>) {
    if (!detection) return;
    switch (item.value) {
      case 'auto':
        onNext({ starshipInstalled: false, packageManager: detection.pm });
        break;
      case 'manual':
        setShowManualHelp(true);
        break;
    }
  }

  async function handleManualChoice(item: Item<ManualChoice>) {
    if (!detection) return;
    switch (item.value) {
      case 'recheck':
        setShowManualHelp(false);
        setDetection(null);
        await runDetection();
        break;
      case 'continue':
        onNext({
          starshipInstalled: false,
          packageManager: detection.pm,
          skipStarshipInstall: true,
        });
        break;
    }
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
                  {showManualHelp ? (
                    <Box flexDirection="column" gap={1}>
                      <Text color="gray">
                        Install Starship:{' '}
                        <Text color="cyan">curl -sS https://starship.rs/install.sh | sh</Text>
                      </Text>
                      <Text color="gray">
                        Or see{' '}
                        <Text color="cyan" underline>
                          https://starship.rs/guide/#step-1-install-starship
                        </Text>
                      </Text>
                      <SelectInput items={manualItems} onSelect={handleManualChoice} />
                    </Box>
                  ) : (
                    <SelectInput items={installItems} onSelect={handleInstallChoice} />
                  )}
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
