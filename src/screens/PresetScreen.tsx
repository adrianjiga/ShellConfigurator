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
  const presetIndex = Math.max(
    0,
    compatible.findIndex((p) => p.id === state.preset)
  );
  const [highlightedId, setHighlightedId] = useState<string>(() => {
    const chosen = compatible[presetIndex] ?? compatible[0];
    if (!chosen) throw new Error('No compatible presets available');
    return chosen.id;
  });
  // A revisit would replace customised state, so it is confirmed first.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const confirmingPreset = PRESETS.find((p) => p.id === confirmingId);

  const items = compatible.map((p) => ({
    label: p.requiresNerdFont ? `${p.label} ★` : p.label,
    value: p.id,
  }));

  const apply = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    onNext({
      preset: preset.id,
      leftModules: [...preset.leftModules],
      rightModules: [...preset.rightModules],
      // Seeds the Style screen's pickers; the user can still change both there.
      palette: preset.palette,
      powerline: preset.powerline,
    });
  };

  useInput((_, key) => {
    if (!confirmingPreset) {
      if (key.escape) onBack();
      return;
    }
    if (key.return) apply(confirmingPreset.id);
    else if (key.escape) setConfirmingId(null);
  });

  const handleSelect = (item: { value: string }) => {
    if (state.preset === null) apply(item.value);
    else setConfirmingId(item.value);
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
            initialIndex={presetIndex}
            isFocused={!confirmingPreset}
            onSelect={handleSelect}
            onHighlight={(item) => setHighlightedId(item.value)}
            limit={8}
          />
        </Box>

        <Box marginTop={1}>
          {confirmingPreset ? (
            <Text color={uiColor('yellow')}>
              Apply "{confirmingPreset.label}"? This replaces your segment and style choices.
            </Text>
          ) : (
            <Text color={uiColor('gray')} italic>
              {compatible.find((p) => p.id === highlightedId)?.description}
            </Text>
          )}
        </Box>
      </Box>

      <NavHints
        hints={
          confirmingPreset
            ? [
                { key: 'Enter', label: 'apply' },
                { key: 'Esc', label: 'cancel' },
              ]
            : [
                { key: '↑↓', label: 'navigate' },
                { key: 'Enter', label: 'select' },
                { key: 'Esc', label: 'back' },
              ]
        }
      />
    </WizardLayout>
  );
}
