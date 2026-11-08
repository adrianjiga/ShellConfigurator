import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { AppSelectInput } from '../components/AppSelectInput.tsx';
import { NavHints } from '../components/NavHints.tsx';
import { WizardLayout } from '../components/WizardLayout.tsx';
import { uiColor } from '../config/colors.ts';
import { PRESETS } from '../config/presets.ts';
import type { WizardState } from '../types.ts';

interface PresetScreenProps {
  state: WizardState;
  onNext: (update: Partial<WizardState>) => void;
  onBack: () => void;
}

export function PresetScreen({ state, onNext, onBack }: PresetScreenProps) {
  const compatible = PRESETS.filter((p) => !p.requiresNerdFont || state.hasNerdFont);
  const [highlightedId, setHighlightedId] = useState<string>(() => {
    const first = compatible[0];
    if (!first) throw new Error('No compatible presets available');
    return first.id;
  });

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
      // Seeds the Style screen's pickers; the user can still change both there.
      palette: preset.palette,
      powerline: preset.powerline,
    });
  };

  return (
    <WizardLayout state={state}>
      <Box flexDirection="column" gap={1}>
        <Text bold>Choose a starting preset</Text>
        <Text color={uiColor('gray')}>
          Select a preset theme to start from.{' '}
          {state.hasNerdFont && <Text color={uiColor('gray')}>★ = requires Nerd Font</Text>}
          {!state.hasNerdFont && (
            <Text color={uiColor('yellow')}>Nerd Font presets hidden (no Nerd Font detected)</Text>
          )}
        </Text>

        <Box marginTop={1} flexDirection="column">
          <AppSelectInput
            items={items}
            onSelect={handleSelect}
            onHighlight={(item) => setHighlightedId(item.value)}
            limit={8}
          />
        </Box>

        {/* Description of highlighted preset */}
        <Box marginTop={1}>
          <Text color={uiColor('gray')} italic>
            {compatible.find((p) => p.id === highlightedId)?.description}
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
