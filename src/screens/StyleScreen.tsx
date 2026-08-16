import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { WizardState, CharacterSymbol } from '../types.ts';
import { PALETTES, inkColor, type PaletteColorName } from '../config/palettes.ts';
import { WizardLayout } from '../components/WizardLayout.tsx';
import { NavHints } from '../components/NavHints.tsx';

interface StyleScreenProps {
  state: WizardState;
  onNext: (update: Partial<WizardState>) => void;
  onUpdate: (update: Partial<WizardState>) => void;
  onBack: () => void;
}

const CHAR_OPTIONS: { value: CharacterSymbol; label: string; preview: string }[] = [
  { value: 'arrow', label: 'Arrow', preview: '❯' },
  { value: 'lambda', label: 'Lambda', preview: 'λ' },
  { value: 'dollar', label: 'Dollar', preview: '$' },
];

/** The colours shown as dots beside each palette name in the picker. */
const SWATCH_COLORS: PaletteColorName[] = ['directory', 'git_branch', 'git_status', 'nodejs', 'ok'];

const POWERLINE_OPTIONS: { value: boolean; label: string; description: string }[] = [
  { value: false, label: 'Plain', description: 'Coloured text, no backgrounds' },
  {
    value: true,
    label: 'Powerline',
    description: 'Interlocking coloured blocks (needs a Nerd Font)',
  },
];

type FocusSection = 'char' | 'color' | 'powerline';

export function StyleScreen({ state, onNext, onUpdate, onBack }: StyleScreenProps) {
  const [charIdx, setCharIdx] = useState(() =>
    Math.max(
      0,
      CHAR_OPTIONS.findIndex((o) => o.value === state.characterSymbol)
    )
  );
  const [colorIdx, setColorIdx] = useState(() =>
    Math.max(
      0,
      PALETTES.findIndex((o) => o.id === state.palette)
    )
  );
  const [powerlineIdx, setPowerlineIdx] = useState(() =>
    POWERLINE_OPTIONS.findIndex((o) => o.value === state.powerline)
  );
  const [focus, setFocus] = useState<FocusSection>('char');
  const isInitialMount = useRef(true);

  const selection = (): Partial<WizardState> => ({
    characterSymbol: CHAR_OPTIONS[charIdx]!.value,
    palette: PALETTES[colorIdx]!.id as WizardState['palette'],
    powerline: POWERLINE_OPTIONS[powerlineIdx]!.value,
  });

  // Push live updates to parent state so preview stays in sync (skip initial mount)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    onUpdate(selection());
    // onUpdate is a fresh closure each parent render; including it would loop on
    // every state push. `selection` closes over the same three indices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charIdx, colorIdx, powerlineIdx]);

  useInput((_, key) => {
    if (key.escape) {
      onBack();
      return;
    }

    if (key.tab) {
      setFocus((f) => (f === 'char' ? 'color' : f === 'color' ? 'powerline' : 'char'));
      return;
    }

    if (key.return) {
      onNext(selection());
      return;
    }

    if (focus === 'char') {
      if (key.upArrow) setCharIdx((i) => Math.max(0, i - 1));
      if (key.downArrow) setCharIdx((i) => Math.min(CHAR_OPTIONS.length - 1, i + 1));
    } else if (focus === 'color') {
      if (key.upArrow) setColorIdx((i) => Math.max(0, i - 1));
      if (key.downArrow) setColorIdx((i) => Math.min(PALETTES.length - 1, i + 1));
    } else {
      if (key.upArrow) setPowerlineIdx((i) => Math.max(0, i - 1));
      if (key.downArrow) setPowerlineIdx((i) => Math.min(POWERLINE_OPTIONS.length - 1, i + 1));
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

        {/* Palette picker */}
        <Box flexDirection="column" marginTop={1}>
          <Text color={focus === 'color' ? 'cyan' : 'gray'} bold={focus === 'color'}>
            Colour palette
          </Text>
          {PALETTES.map((opt, i) => (
            <Box key={opt.id} flexDirection="row" gap={1} marginLeft={1}>
              <Text color={focus === 'color' && i === colorIdx ? 'cyan' : 'gray'}>
                {focus === 'color' && i === colorIdx ? '›' : ' '}
              </Text>
              <Text color={i === colorIdx ? 'white' : 'gray'} bold={i === colorIdx}>
                {opt.label}
              </Text>
              {/* A swatch of the palette's own colours, so the list shows what it
                  is describing rather than only naming it. */}
              {SWATCH_COLORS.map((name) => (
                <Text key={name} color={inkColor(opt.colors[name])}>
                  ●
                </Text>
              ))}
            </Box>
          ))}
        </Box>

        {/* Powerline toggle */}
        <Box flexDirection="column" marginTop={1}>
          <Text color={focus === 'powerline' ? 'cyan' : 'gray'} bold={focus === 'powerline'}>
            Segment style
          </Text>
          {POWERLINE_OPTIONS.map((opt, i) => (
            <Box key={opt.label} flexDirection="row" gap={1} marginLeft={1}>
              <Text color={focus === 'powerline' && i === powerlineIdx ? 'cyan' : 'gray'}>
                {focus === 'powerline' && i === powerlineIdx ? '›' : ' '}
              </Text>
              <Text color={i === powerlineIdx ? 'white' : 'gray'} bold={i === powerlineIdx}>
                {opt.label}
              </Text>
              <Text color="gray" italic>
                {' '}
                — {opt.description}
              </Text>
            </Box>
          ))}
          {POWERLINE_OPTIONS[powerlineIdx]!.value && !state.hasNerdFont && (
            <Text color="yellow">
              {'  '}Powerline separators need a Nerd Font — a plain prompt will be generated
              instead.
            </Text>
          )}
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
