import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { WizardState } from '../types.js';
import { MODULES } from '../config/modules.js';
import { WizardLayout } from '../components/WizardLayout.js';
import { NavHints } from '../components/NavHints.js';

interface SegmentsScreenProps {
  state: WizardState;
  side: 'left' | 'right';
  onNext: (update: Partial<WizardState>) => void;
  onUpdate: (update: Partial<WizardState>) => void;
  onBack: () => void;
}

// 'character' is always added automatically at the end of left prompt
const CONFIGURABLE = MODULES.filter((m) => m.id !== 'character');

export function SegmentsScreen({ state, side, onNext, onUpdate, onBack }: SegmentsScreenProps) {
  const currentModules = side === 'left' ? state.leftModules : state.rightModules;

  const [enabled, setEnabled] = useState<Set<string>>(
    () => new Set(currentModules.filter((m) => m !== 'character'))
  );
  const [cursor, setCursor] = useState(0);

  // Push live updates to parent state so preview stays in sync
  useEffect(() => {
    const ordered = CONFIGURABLE.filter((m) => enabled.has(m.id)).map((m) => m.id);
    if (side === 'left') {
      onUpdate({ leftModules: [...ordered, 'character'] });
    } else {
      onUpdate({ rightModules: ordered });
    }
  }, [enabled, side]);

  function saveAndProceed() {
    const ordered = CONFIGURABLE.filter((m) => enabled.has(m.id)).map((m) => m.id);
    if (side === 'left') {
      onNext({ leftModules: [...new Set([...ordered, 'character'])] });
    } else {
      onNext({ rightModules: ordered });
    }
  }

  useInput((char, key) => {
    if (key.escape || key.leftArrow) {
      onBack();
      return;
    }

    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }

    if (key.downArrow) {
      setCursor((c) => Math.min(CONFIGURABLE.length - 1, c + 1));
      return;
    }

    if (char === ' ') {
      const id = CONFIGURABLE[cursor]!.id;
      setEnabled((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }

    if (key.return || key.tab || key.rightArrow) {
      saveAndProceed();
    }
  });

  return (
    <WizardLayout state={state}>
      <Box flexDirection="column" gap={1}>
        <Text bold>{side === 'left' ? 'Left prompt segments' : 'Right prompt segments'}</Text>
        <Text color="gray">
          {side === 'left'
            ? 'Choose which info appears on the left of your prompt.'
            : 'Choose which info appears on the right (optional — press Enter to skip).'}
        </Text>
        {side === 'left' && (
          <Text color="gray" italic>
            The prompt character (❯ λ $) is always shown at the end.
          </Text>
        )}

        <Box flexDirection="column" marginTop={1}>
          {CONFIGURABLE.map((mod, i) => {
            const isActive = i === cursor;
            const isChecked = enabled.has(mod.id);
            return (
              <Box key={mod.id} flexDirection="row" gap={1}>
                <Text color={isActive ? 'cyan' : 'gray'}>{isActive ? '›' : ' '}</Text>
                <Text color={isChecked ? 'green' : 'gray'}>{isChecked ? '[✓]' : '[ ]'}</Text>
                <Text color={isActive ? 'white' : 'gray'} bold={isActive}>
                  {mod.label}
                </Text>
                {isActive && (
                  <Text color="gray" italic>
                    {' '}
                    — {mod.description}
                  </Text>
                )}
              </Box>
            );
          })}
        </Box>
      </Box>

      <NavHints
        hints={[
          { key: '↑↓', label: 'navigate' },
          { key: 'Space', label: 'toggle' },
          { key: 'Enter/Tab/→', label: side === 'right' ? 'confirm / skip' : 'next' },
          { key: 'Esc', label: 'back' },
        ]}
      />
    </WizardLayout>
  );
}
