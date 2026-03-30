import React from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { WizardState } from '../types.js';
import { PRESETS } from '../config/presets.js';
import { WizardLayout } from '../components/WizardLayout.js';
import { NavHints } from '../components/NavHints.js';

interface PresetScreenProps {
  state: WizardState;
  onNext: (update: Partial<WizardState>) => void;
  onBack: () => void;
}

export function PresetScreen({ state, onNext, onBack }: PresetScreenProps) {
  const compatible = PRESETS.filter((p) => !p.requiresNerdFont || state.hasNerdFont);

  const items = compatible.map((p) => ({
    label: p.requiresNerdFont ? `${p.label} ★` : p.label,
    value: p.id,
  }));

  useInput((_, key) => {
    if (key.escape) onBack();
  });

  const handleSelect = (item: { value: string }) => {
    const preset = PRESETS.find((p) => p.id === item.value);
    if (!preset) return;
    onNext({
      preset: preset.id,
      leftModules: preset.leftModules ?? state.leftModules,
      rightModules: preset.rightModules ?? state.rightModules,
    });
  };

  return (
    <WizardLayout state={state}>
      <Box flexDirection="column" gap={1}>
        <Text bold>Choose a starting preset</Text>
        <Text color="gray">
          Select a preset theme to start from.{' '}
          {state.hasNerdFont && <Text color="gray">★ = requires Nerd Font</Text>}
          {!state.hasNerdFont && (
            <Text color="yellow">Nerd Font presets hidden (no Nerd Font detected)</Text>
          )}
        </Text>

        <Box marginTop={1} flexDirection="column">
          <SelectInput items={items} onSelect={handleSelect} limit={8} />
        </Box>

        {/* Description of highlighted preset */}
        <Box marginTop={1}>
          <Text color="gray" italic>
            {compatible[0]?.description}
          </Text>
        </Box>
      </Box>

      <NavHints
        hints={[
          { key: '↑↓', label: 'navigate' },
          { key: 'Enter', label: 'select' },
          { key: 'Esc', label: 'back' },
        ]}
      />
    </WizardLayout>
  );
}
