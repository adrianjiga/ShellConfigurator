import { Box, Text, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';
import { NavHints } from '../components/NavHints.tsx';
import { PickerRow } from '../components/PickerRow.tsx';
import { WizardLayout } from '../components/WizardLayout.tsx';
import { uiColor } from '../config/colors.ts';
import { SHELLS } from '../config/shells.ts';
import { detectCurrentShellAsync, detectInstalledShellsAsync } from '../services/detector.ts';
import { shellInstallSupported } from '../services/installer.ts';
import type { ShellId, WizardState } from '../types.ts';

interface ShellScreenProps {
  state: WizardState;
  onNext: (update: Partial<WizardState>) => void;
  onUpdate: (update: Partial<WizardState>) => void;
  onBack: () => void;
}

export function ShellScreen({ state, onNext, onUpdate, onBack }: ShellScreenProps) {
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<ShellId>>(() => new Set(state.selectedShells));
  const [installedShells, setInstalledShells] = useState<ShellId[] | null>(null);
  const [defaultShell, setDefaultShell] = useState<ShellId | null>(state.setDefaultShell);
  // The selection and default shell are read through refs inside useInput, so a
  // burst of keys in one input chunk sees each earlier key's change.
  const defaultShellRef = useRef(defaultShell);
  defaultShellRef.current = defaultShell;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const touched = useRef(false);

  // Shell detection runs once on mount; onUpdate is a fresh closure each render
  // and would re-trigger it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: onUpdate is a fresh closure each render.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const detected = await detectInstalledShellsAsync();
      if (!cancelled) {
        setInstalledShells(detected);
        onUpdate({ installedShells: detected });
      }
    })();

    // Pre-select the shell the wizard is running in, but only when the user
    // hasn't already made a choice (won't clobber a back-navigation selection).
    if (selectedRef.current.size === 0) {
      (async () => {
        const current = await detectCurrentShellAsync();
        // A choice the user made while detection ran wins over the guess.
        if (!cancelled && current && !touched.current && !selectedRef.current.has(current)) {
          const next = new Set(selectedRef.current);
          next.add(current);
          selectedRef.current = next;
          setSelected(next);
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, []);

  // Sorted against SHELLS rather than click order, so install order and the
  // Done-screen rows are deterministic.
  const orderedSelection = (): ShellId[] =>
    SHELLS.filter((s) => selectedRef.current.has(s.id)).map((s) => s.id);

  useInput((char, key) => {
    if (key.escape) {
      // Keep the choices for when the user comes back, as the other screens do.
      onUpdate({ selectedShells: orderedSelection(), setDefaultShell: defaultShellRef.current });
      onBack();
      return;
    }

    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }

    if (key.downArrow) {
      setCursor((c) => Math.min(SHELLS.length - 1, c + 1));
      return;
    }

    if (char === ' ') {
      const shellId = SHELLS[cursor]!.id;
      touched.current = true;
      const next = new Set(selectedRef.current);
      if (next.has(shellId)) {
        next.delete(shellId);
        if (defaultShellRef.current === shellId) setDefaultShell(null);
      } else {
        next.add(shellId);
      }
      selectedRef.current = next;
      setSelected(next);
      return;
    }

    // A container's login shell belongs to the image, so chsh is never run there.
    if ((char === 'd' || char === 'D') && !state.container) {
      const shellId = SHELLS[cursor]!.id;
      if (selectedRef.current.has(shellId)) {
        setDefaultShell((prev) => (prev === shellId ? null : shellId));
      }
      return;
    }

    if (key.return && selectedRef.current.size > 0 && installedShells !== null) {
      onNext({
        selectedShells: orderedSelection(),
        installedShells,
        setDefaultShell: defaultShell,
      });
    }
  });

  return (
    <WizardLayout state={state}>
      <Box flexDirection="column" gap={1}>
        <Text bold>Select your shell(s)</Text>
        <Text color={uiColor('gray')}>Which shells should be configured to use Starship?</Text>
        {state.container ? (
          <Text color={uiColor('gray')}>
            Inside a container the login shell is left to the image, so none is set here.
          </Text>
        ) : (
          <Text color={uiColor('gray')}>
            Press <Text color={uiColor('cyan')}>D</Text> on any selected shell to make it your login
            shell (runs <Text color={uiColor('cyan')}>chsh</Text>). Optional.
          </Text>
        )}

        <Box flexDirection="column" marginTop={1}>
          {SHELLS.map((shell, i) => {
            const isActive = i === cursor;
            const isChecked = selected.has(shell.id);
            const isInstalled = installedShells?.includes(shell.id) ?? false;
            const isDefault = defaultShell === shell.id;

            return (
              <PickerRow
                key={shell.id}
                focused={isActive}
                selected={isChecked}
                marker={isChecked ? '[✓]' : '[ ]'}
                label={shell.label}
                suffix={
                  <>
                    {isChecked && (
                      <Text color={uiColor(isInstalled ? 'green' : 'yellow')}>
                        {isInstalled
                          ? '[installed]'
                          : shellInstallSupported(shell.id, state.packageManager)
                            ? '[will install]'
                            : '[install it yourself]'}
                      </Text>
                    )}
                    {isDefault && <Text color={uiColor('cyan')}>[will set as login shell]</Text>}
                  </>
                }
                hint={
                  shell.rcFile ? (
                    `→ ${shell.rcFile}`
                  ) : shell.manualNote ? (
                    <Text color={uiColor('yellow')} italic>
                      ⚠ Manual setup required — the wizard shows the setup command after
                      installation.
                    </Text>
                  ) : undefined
                }
              />
            );
          })}
        </Box>

        {installedShells === null && (
          <Text color={uiColor('yellow')} italic>
            Detecting installed shells…
          </Text>
        )}
        {selected.size === 0 && installedShells !== null && (
          <Text color={uiColor('yellow')} italic>
            Select at least one shell to continue.
          </Text>
        )}
      </Box>

      <NavHints
        hints={[
          { key: '↑↓', label: 'navigate' },
          { key: 'Space', label: 'toggle' },
          ...(state.container ? [] : [{ key: 'D', label: 'set as login shell' }]),
          {
            key: 'Enter',
            label:
              installedShells === null
                ? '(detecting shells…)'
                : selected.size > 0
                  ? 'confirm'
                  : '(select a shell first)',
          },
          { key: 'Esc', label: 'back' },
        ]}
      />
    </WizardLayout>
  );
}
