import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { WizardState, CharacterSymbol, ColorScheme } from '../types.js';
import { WizardLayout } from '../components/WizardLayout.js';
import { NavHints } from '../components/NavHints.js';

interface StyleScreenProps {
  state: WizardState;
  onNext: (update: Partial<WizardState>) => void;
  onBack: () => void;
}

const CHAR_OPTIONS: { value: CharacterSymbol; label: string; preview: string }[] = [
  { value: 'arrow', label: 'Arrow', preview: '❯' },
  { value: 'lambda', label: 'Lambda', preview: 'λ' },
  { value: 'dollar', label: 'Dollar', preview: '$' },
];

const COLOR_OPTIONS: { value: ColorScheme; label: string; description: string }[] = [
  { value: 'default', label: 'Default', description: 'Bold blues, purples, greens' },
  { value: 'pastel', label: 'Pastel', description: 'Softer cyans and magentas' },
  { value: 'minimal', label: 'Minimal', description: 'White and muted tones' },
];

type FocusSection = 'char' | 'color';

export function StyleScreen({ state, onNext, onBack }: StyleScreenProps) {
  const [charIdx, setCharIdx] = useState(() =>
    Math.max(
      0,
      CHAR_OPTIONS.findIndex((o) => o.value === state.characterSymbol)
    )
  );
  const [colorIdx, setColorIdx] = useState(() =>
    Math.max(
      0,
      COLOR_OPTIONS.findIndex((o) => o.value === state.colorScheme)
    )
  );
  const [focus, setFocus] = useState<FocusSection>('char');

  useInput((_, key) => {
    if (key.escape) {
      onBack();
      return;
    }

    if (key.tab) {
      setFocus((f) => (f === 'char' ? 'color' : 'char'));
      return;
    }

    if (key.return) {
      onNext({
        characterSymbol: CHAR_OPTIONS[charIdx]!.value,
        colorScheme: COLOR_OPTIONS[colorIdx]!.value,
      });
      return;
    }

    if (focus === 'char') {
      if (key.upArrow) setCharIdx((i) => Math.max(0, i - 1));
      if (key.downArrow) setCharIdx((i) => Math.min(CHAR_OPTIONS.length - 1, i + 1));
    } else {
      if (key.upArrow) setColorIdx((i) => Math.max(0, i - 1));
      if (key.downArrow) setColorIdx((i) => Math.min(COLOR_OPTIONS.length - 1, i + 1));
    }
  });

  return (
    <WizardLayout state={state}>
      <Box flexDirection="column" gap={1}>
        <Text bold>Style options</Text>

        {/* Character symbol picker */}
        <Box flexDirection="column" marginTop={1}>
          <Text color={focus === 'char' ? 'cyan' : 'gray'} bold={focus === 'char'}>
            Prompt character
          </Text>
          {CHAR_OPTIONS.map((opt, i) => (
            <Box key={opt.value} flexDirection="row" gap={1} marginLeft={1}>
              <Text color={focus === 'char' && i === charIdx ? 'cyan' : 'gray'}>
                {focus === 'char' && i === charIdx ? '›' : ' '}
              </Text>
              <Text color={i === charIdx ? 'white' : 'gray'} bold={i === charIdx}>
                {opt.preview} {opt.label}
              </Text>
            </Box>
          ))}
        </Box>

        {/* Color scheme picker */}
        <Box flexDirection="column" marginTop={1}>
          <Text color={focus === 'color' ? 'cyan' : 'gray'} bold={focus === 'color'}>
            Color scheme
          </Text>
          {COLOR_OPTIONS.map((opt, i) => (
            <Box key={opt.value} flexDirection="row" gap={1} marginLeft={1}>
              <Text color={focus === 'color' && i === colorIdx ? 'cyan' : 'gray'}>
                {focus === 'color' && i === colorIdx ? '›' : ' '}
              </Text>
              <Text color={i === colorIdx ? 'white' : 'gray'} bold={i === colorIdx}>
                {opt.label}
              </Text>
              <Text color="gray" italic>
                {' '}
                — {opt.description}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>

      <NavHints
        hints={[
          { key: '↑↓', label: 'navigate' },
          { key: 'Tab', label: 'switch section' },
          { key: 'Enter', label: 'confirm' },
          { key: 'Esc', label: 'back' },
        ]}
      />
    </WizardLayout>
  );
}
