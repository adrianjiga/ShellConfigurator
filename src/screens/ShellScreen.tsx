import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { WizardState, ShellId } from '../types.js';
import { SHELLS } from '../config/shells.js';
import { WizardLayout } from '../components/WizardLayout.js';
import { NavHints } from '../components/NavHints.js';

interface ShellScreenProps {
  state: WizardState;
  onNext: (update: Partial<WizardState>) => void;
  onBack: () => void;
}

export function ShellScreen({ state, onNext, onBack }: ShellScreenProps) {
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<ShellId>>(
    () => new Set(state.selectedShells)
  );

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

    if (char === ' ' || key.return) {
      const shellId = SHELLS[cursor]!.id;

      if (key.return && selected.size > 0) {
        // Enter confirms selection
        onNext({ selectedShells: Array.from(selected) });
        return;
      }

      // Space toggles
      if (char === ' ') {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(shellId)) next.delete(shellId);
          else next.add(shellId);
          return next;
        });
      }
    }
  });

  return (
    <WizardLayout state={state}>
      <Box flexDirection="column" gap={1}>
        <Text bold>Select your shell(s)</Text>
        <Text color="gray">
          Which shells should be configured to use Starship?
        </Text>

        <Box flexDirection="column" marginTop={1}>
          {SHELLS.map((shell, i) => {
            const isActive = i === cursor;
            const isChecked = selected.has(shell.id);
            return (
              <Box key={shell.id} flexDirection="column">
                <Box flexDirection="row" gap={1}>
                  <Text color={isActive ? 'cyan' : 'gray'}>
                    {isActive ? '›' : ' '}
                  </Text>
                  <Text color={isChecked ? 'green' : 'gray'}>
                    {isChecked ? '[✓]' : '[ ]'}
                  </Text>
                  <Text color={isActive ? 'white' : 'gray'} bold={isActive}>
                    {shell.label}
                  </Text>
                </Box>
                {isActive && shell.rcFile && (
                  <Box marginLeft={4}>
                    <Text color="gray" italic>→ {shell.rcFile}</Text>
                  </Box>
                )}
                {isActive && shell.manualNote && (
                  <Box marginLeft={4}>
                    <Text color="yellow" italic>⚠ Manual setup required</Text>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>

        {selected.size === 0 && (
          <Text color="yellow" italic>Select at least one shell to continue.</Text>
        )}
      </Box>

      <NavHints hints={[
        { key: '↑↓', label: 'navigate' },
        { key: 'Space', label: 'toggle' },
        { key: 'Enter', label: selected.size > 0 ? 'confirm' : '(select a shell first)' },
        { key: 'Esc', label: 'back' },
      ]} />
    </WizardLayout>
  );
}
