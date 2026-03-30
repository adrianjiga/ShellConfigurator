import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { WizardState, ShellId } from '../types.js';
import { SHELLS } from '../config/shells.js';
import { detectInstalledShells } from '../services/detector.js';
import { WizardLayout } from '../components/WizardLayout.js';
import { NavHints } from '../components/NavHints.js';

interface ShellScreenProps {
  state: WizardState;
  onNext: (update: Partial<WizardState>) => void;
  onUpdate: (update: Partial<WizardState>) => void;
  onBack: () => void;
}

export function ShellScreen({ state, onNext, onUpdate, onBack }: ShellScreenProps) {
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<ShellId>>(() => new Set(state.selectedShells));
  const [installedShells, setInstalledShells] = useState<ShellId[]>(state.installedShells);
  const [defaultShell, setDefaultShell] = useState<ShellId | null>(state.setDefaultShell);

  useEffect(() => {
    const detected = detectInstalledShells();
    setInstalledShells(detected);
    onUpdate({ installedShells: detected });
  }, []);

  useInput((char, key) => {
    if (key.escape) {
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
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(shellId)) {
          next.delete(shellId);
          // Clear default shell if deselected
          if (defaultShell === shellId) setDefaultShell(null);
        } else {
          next.add(shellId);
        }
        return next;
      });
      return;
    }

    if (char === 'd' || char === 'D') {
      const shellId = SHELLS[cursor]!.id;
      if (selected.has(shellId)) {
        setDefaultShell((prev) => (prev === shellId ? null : shellId));
      }
      return;
    }

    if (key.return && selected.size > 0) {
      onNext({
        selectedShells: Array.from(selected),
        installedShells,
        setDefaultShell: defaultShell,
      });
    }
  });

  return (
    <WizardLayout state={state}>
      <Box flexDirection="column" gap={1}>
        <Text bold>Select your shell(s)</Text>
        <Text color="gray">Which shells should be configured to use Starship?</Text>
        <Text color="gray">
          Press <Text color="cyan">D</Text> on any selected shell to make it your login shell (runs{' '}
          <Text color="cyan">chsh</Text>). Optional.
        </Text>

        <Box flexDirection="column" marginTop={1}>
          {SHELLS.map((shell, i) => {
            const isActive = i === cursor;
            const isChecked = selected.has(shell.id);
            const isInstalled = installedShells.includes(shell.id);
            const isDefault = defaultShell === shell.id;

            return (
              <Box key={shell.id} flexDirection="column">
                <Box flexDirection="row" gap={1}>
                  <Text color={isActive ? 'cyan' : 'gray'}>{isActive ? '›' : ' '}</Text>
                  <Text color={isChecked ? 'green' : 'gray'}>{isChecked ? '[✓]' : '[ ]'}</Text>
                  <Text color={isActive ? 'white' : 'gray'} bold={isActive}>
                    {shell.label}
                  </Text>
                  <Text color={isInstalled ? 'green' : 'yellow'}>
                    {isInstalled ? '[installed]' : '[will install]'}
                  </Text>
                  {isDefault && <Text color="cyan">[will set as login shell]</Text>}
                </Box>
                {isActive && shell.rcFile && (
                  <Box marginLeft={4}>
                    <Text color="gray" italic>
                      → {shell.rcFile}
                    </Text>
                  </Box>
                )}
                {isActive && shell.manualNote && (
                  <Box marginLeft={4}>
                    <Text color="yellow" italic>
                      ⚠ {shell.manualNote}
                    </Text>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>

        {selected.size === 0 && (
          <Text color="yellow" italic>
            Select at least one shell to continue.
          </Text>
        )}
      </Box>

      <NavHints
        hints={[
          { key: '↑↓', label: 'navigate' },
          { key: 'Space', label: 'toggle' },
          { key: 'D', label: 'set as login shell' },
          { key: 'Enter', label: selected.size > 0 ? 'confirm' : '(select a shell first)' },
          { key: 'Esc', label: 'back' },
        ]}
      />
    </WizardLayout>
  );
}
