import { Box, Text, useInput } from 'ink';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppSelectInput } from '../components/AppSelectInput.tsx';
import { NavHints } from '../components/NavHints.tsx';
import { WizardLayout } from '../components/WizardLayout.tsx';
import { uiColor } from '../config/colors.ts';
import {
  detectContainerAsync,
  detectPackageManagerAsync,
  detectTerminalAsync,
  findStarshipAsync,
} from '../services/detector.ts';
import { MANUAL_STARSHIP_INSTALL } from '../services/installer.ts';
import { TERMINAL_LABELS } from '../services/terminalFont.ts';
import type { PackageManager, TerminalId, WizardState } from '../types.ts';

interface WelcomeScreenProps {
  state: WizardState;
  onNext: (update: Partial<WizardState>) => void;
}

interface Detection {
  starship: { installed: boolean; version?: string; pathDir?: string };
  pm: PackageManager;
  terminal: TerminalId | null;
  container: boolean;
}

type InstallChoice = 'auto' | 'manual';
type ManualChoice = 'recheck' | 'continue';
type Item<V> = { label: string; value: V };

const PM_LABELS: Record<PackageManager, string> = {
  pacman: 'pacman (Arch)',
  apt: 'apt (Debian/Ubuntu)',
  dnf: 'dnf (Fedora)',
  brew: 'Homebrew',
  apk: 'apk (Alpine)',
  script: 'install script (no package manager detected)',
};

export function WelcomeScreen({ state, onNext }: WelcomeScreenProps) {
  const [detection, setDetection] = useState<Detection | null>(null);
  const [showManualHelp, setShowManualHelp] = useState(false);

  const [stillMissing, setStillMissing] = useState(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );

  const runDetection = useCallback(
    async (shouldDrop: () => boolean = () => false): Promise<Detection | null> => {
      const [pm, starship, terminal, container] = await Promise.all([
        detectPackageManagerAsync(),
        findStarshipAsync(),
        detectTerminalAsync(),
        detectContainerAsync(),
      ]);
      if (shouldDrop()) return null;
      const found = { pm, starship, terminal, container };
      setDetection(found);
      return found;
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    void runDetection(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [runDetection]);

  /** What detection found, plus whether this run installs Starship. */
  function proceed(found: Detection, skipStarshipInstall: boolean) {
    onNext({
      packageManager: found.pm,
      terminal: found.terminal,
      container: found.container,
      skipStarshipInstall,
    });
  }

  useInput((_, key) => {
    if (key.return && detection?.starship.installed) proceed(detection, false);
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
        proceed(detection, false);
        break;
      case 'manual':
        setShowManualHelp(true);
        break;
    }
  }

  async function handleManualChoice(item: Item<ManualChoice>) {
    if (!detection) return;
    switch (item.value) {
      case 'recheck': {
        setStillMissing(false);
        setDetection(null);
        const found = await runDetection(() => !mounted.current);
        // Stay on the manual-install options rather than jumping back to "Install".
        if (found && !found.starship.installed) setStillMissing(true);
        break;
      }
      case 'continue':
        proceed(detection, true);
        break;
    }
  }

  return (
    <WizardLayout state={state} hidePreview>
      <Box flexDirection="column" gap={1}>
        <Text bold color={uiColor('cyan')}>
          Welcome to ShellConfigurator
        </Text>
        <Text color={uiColor('gray')}>
          An interactive wizard for setting up your{' '}
          <Text color={uiColor('cyan')} bold>
            Starship
          </Text>{' '}
          cross-shell prompt.
        </Text>
        <Text color={uiColor('gray')}>Works with zsh, bash, fish, nushell, and powershell.</Text>

        <Box marginTop={1} flexDirection="column" gap={1}>
          {detection === null ? (
            <Text color={uiColor('yellow')}>Detecting system...</Text>
          ) : (
            <>
              <Box flexDirection="row" gap={1}>
                <Text color={uiColor('gray')}>Package manager:</Text>
                <Text color={uiColor('cyan')}>{PM_LABELS[detection.pm]}</Text>
              </Box>

              {detection.terminal && (
                <Box flexDirection="row" gap={1}>
                  <Text color={uiColor('gray')}>Terminal:</Text>
                  <Text color={uiColor('cyan')}>{TERMINAL_LABELS[detection.terminal]}</Text>
                </Box>
              )}

              {detection.container && (
                <Box flexDirection="row" gap={1}>
                  <Text color={uiColor('gray')}>
                    Container detected — font and default-shell steps will be skipped
                  </Text>
                </Box>
              )}

              {detection.starship.installed ? (
                <Box flexDirection="column">
                  <Text color={uiColor('green')}>✓ Starship is installed</Text>
                  {detection.starship.version && (
                    <Text color={uiColor('gray')}> {detection.starship.version}</Text>
                  )}
                  {detection.starship.pathDir && (
                    <Text color={uiColor('gray')}>
                      {' '}
                      in {detection.starship.pathDir}, which the shells will add to PATH
                    </Text>
                  )}
                </Box>
              ) : (
                <Box flexDirection="column" gap={1}>
                  <Text color={uiColor('yellow')}>✗ Starship is not installed</Text>
                  {showManualHelp ? (
                    <Box flexDirection="column" gap={1}>
                      {stillMissing && (
                        <Text color={uiColor('yellow')}>
                          Still not found. Install it in another terminal, then re-check.
                        </Text>
                      )}
                      <Text color={uiColor('gray')}>
                        Install Starship:{' '}
                        <Text color={uiColor('cyan')}>{MANUAL_STARSHIP_INSTALL}</Text>
                      </Text>
                      <Text color={uiColor('gray')}>
                        Or see{' '}
                        <Text color={uiColor('cyan')} underline>
                          https://starship.rs/guide/#step-1-install-starship
                        </Text>
                      </Text>
                      <AppSelectInput items={manualItems} onSelect={handleManualChoice} />
                    </Box>
                  ) : (
                    <AppSelectInput items={installItems} onSelect={handleInstallChoice} />
                  )}
                </Box>
              )}
            </>
          )}
        </Box>
      </Box>

      {detection?.starship.installed && <NavHints hints={[{ key: 'Enter', label: 'continue' }]} />}
      {detection && !detection.starship.installed && (
        <NavHints
          hints={[
            { key: '↑↓', label: 'navigate' },
            { key: 'Enter/1-9', label: 'select' },
          ]}
        />
      )}
    </WizardLayout>
  );
}
