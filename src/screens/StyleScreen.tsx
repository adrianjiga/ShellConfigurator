import { Box, Text, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';
import { NavHints } from '../components/NavHints.tsx';
import { PickerRow } from '../components/PickerRow.tsx';
import { WizardLayout } from '../components/WizardLayout.tsx';
import { inkColor, PALETTES, type PaletteColorName, type PaletteId } from '../config/palettes.ts';
import type { CharacterSymbol, ContinuationPrompt, WizardState } from '../types.ts';

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

const CONTINUATION_OPTIONS: {
  value: ContinuationPrompt;
  label: string;
  description: string;
}[] = [
  { value: 'dot', label: '∙ Dot', description: "Starship's default marker" },
  { value: 'arrow', label: '❯ Arrow', description: 'Matches the prompt character' },
  { value: 'none', label: 'None', description: 'No marker on wrapped lines' },
];

type FocusSection = 'char' | 'color' | 'powerline' | 'continuation' | 'extras';

const FOCUS_ORDER: FocusSection[] = ['char', 'color', 'powerline', 'continuation', 'extras'];

/** The checkbox rows in the "Prompt extras" section, top to bottom. */
const EXTRA_ROWS = ['addNewline', 'vimMode'] as const;
type ExtraRow = (typeof EXTRA_ROWS)[number];

export function StyleScreen({ state, onNext, onUpdate, onBack }: StyleScreenProps) {
  const [characterSymbol, setCharacterSymbol] = useState<CharacterSymbol>(state.characterSymbol);
  const [palette, setPalette] = useState<PaletteId>(state.palette);
  const [powerline, setPowerline] = useState<boolean>(state.powerline);
  const [continuationPrompt, setContinuationPrompt] = useState<ContinuationPrompt>(
    state.continuationPrompt
  );
  const [addNewline, setAddNewline] = useState<boolean>(state.addNewline);
  const [vimMode, setVimMode] = useState<boolean>(state.vimMode);
  const [focus, setFocus] = useState<FocusSection>('char');
  const [extraCursor, setExtraCursor] = useState(0);
  const isInitialMount = useRef(true);

  const charIdx = CHAR_OPTIONS.findIndex((o) => o.value === characterSymbol);
  const colorIdx = PALETTES.findIndex((o) => o.id === palette);
  const powerlineIdx = POWERLINE_OPTIONS.findIndex((o) => o.value === powerline);
  const continuationIdx = CONTINUATION_OPTIONS.findIndex((o) => o.value === continuationPrompt);

  const selection = (): Partial<WizardState> => ({
    characterSymbol,
    palette,
    powerline,
    continuationPrompt,
    addNewline,
    vimMode,
  });

  // Push live updates to parent state so preview stays in sync (skip initial
  // mount). onUpdate is a fresh closure each render; including it would loop on
  // every state push.
  // biome-ignore lint/correctness/useExhaustiveDependencies: onUpdate is a fresh closure each render.
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    onUpdate(selection());
  }, [characterSymbol, palette, powerline, continuationPrompt, addNewline, vimMode]);

  function toggleExtra(row: ExtraRow) {
    if (row === 'addNewline') setAddNewline((v) => !v);
    else setVimMode((v) => !v);
  }

  useInput((char, key) => {
    if (key.escape) {
      onBack();
      return;
    }

    if (key.tab) {
      setFocus((f) => FOCUS_ORDER[(FOCUS_ORDER.indexOf(f) + 1) % FOCUS_ORDER.length]!);
      return;
    }

    if (key.return) {
      onNext(selection());
      return;
    }

    if (focus === 'char') {
      if (key.upArrow) setCharacterSymbol(CHAR_OPTIONS[Math.max(0, charIdx - 1)].value);
      if (key.downArrow)
        setCharacterSymbol(CHAR_OPTIONS[Math.min(CHAR_OPTIONS.length - 1, charIdx + 1)].value);
    } else if (focus === 'color') {
      if (key.upArrow) setPalette(PALETTES[Math.max(0, colorIdx - 1)].id);
      if (key.downArrow) setPalette(PALETTES[Math.min(PALETTES.length - 1, colorIdx + 1)].id);
    } else if (focus === 'powerline') {
      if (key.upArrow) setPowerline(POWERLINE_OPTIONS[Math.max(0, powerlineIdx - 1)].value);
      if (key.downArrow)
        setPowerline(
          POWERLINE_OPTIONS[Math.min(POWERLINE_OPTIONS.length - 1, powerlineIdx + 1)].value
        );
    } else if (focus === 'continuation') {
      if (key.upArrow)
        setContinuationPrompt(CONTINUATION_OPTIONS[Math.max(0, continuationIdx - 1)].value);
      if (key.downArrow)
        setContinuationPrompt(
          CONTINUATION_OPTIONS[Math.min(CONTINUATION_OPTIONS.length - 1, continuationIdx + 1)].value
        );
    } else {
      if (key.upArrow) setExtraCursor((i) => Math.max(0, i - 1));
      if (key.downArrow) setExtraCursor((i) => Math.min(EXTRA_ROWS.length - 1, i + 1));
      if (char === ' ') toggleExtra(EXTRA_ROWS[extraCursor]!);
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
            <PickerRow
              key={opt.value}
              focused={focus === 'char' && i === charIdx}
              selected={i === charIdx}
              indent={1}
              label={`${opt.preview} ${opt.label}`}
            />
          ))}
        </Box>

        {/* Palette picker */}
        <Box flexDirection="column" marginTop={1}>
          <Text color={focus === 'color' ? 'cyan' : 'gray'} bold={focus === 'color'}>
            Colour palette
          </Text>
          {PALETTES.map((opt, i) => (
            <PickerRow
              key={opt.id}
              focused={focus === 'color' && i === colorIdx}
              selected={i === colorIdx}
              indent={1}
              label={opt.label}
              // A swatch of the palette's own colours, so the list shows what it
              // is describing rather than only naming it.
              suffix={SWATCH_COLORS.map((name) => (
                <Text key={name} color={inkColor(opt.colors[name])}>
                  ●
                </Text>
              ))}
            />
          ))}
        </Box>

        {/* Powerline toggle */}
        <Box flexDirection="column" marginTop={1}>
          <Text color={focus === 'powerline' ? 'cyan' : 'gray'} bold={focus === 'powerline'}>
            Segment style
          </Text>
          {POWERLINE_OPTIONS.map((opt, i) => (
            <PickerRow
              key={opt.label}
              focused={focus === 'powerline' && i === powerlineIdx}
              selected={i === powerlineIdx}
              indent={1}
              label={opt.label}
              suffix={
                <Text color="gray" italic>
                  — {opt.description}
                </Text>
              }
            />
          ))}
          {powerline && !state.hasNerdFont && (
            <Text color="yellow">
              {'  '}Powerline separators need a Nerd Font — a plain prompt will be generated
              instead.
            </Text>
          )}
        </Box>

        {/* Continuation prompt picker */}
        <Box flexDirection="column" marginTop={1}>
          <Text color={focus === 'continuation' ? 'cyan' : 'gray'} bold={focus === 'continuation'}>
            Wrapped-line marker
          </Text>
          {CONTINUATION_OPTIONS.map((opt, i) => (
            <PickerRow
              key={opt.value}
              focused={focus === 'continuation' && i === continuationIdx}
              selected={i === continuationIdx}
              indent={1}
              label={opt.label}
              suffix={
                <Text color="gray" italic>
                  — {opt.description}
                </Text>
              }
            />
          ))}
        </Box>

        {/* Prompt extras: two independent checkboxes. */}
        <Box flexDirection="column" marginTop={1}>
          <Text color={focus === 'extras' ? 'cyan' : 'gray'} bold={focus === 'extras'}>
            Prompt extras
          </Text>
          <PickerRow
            focused={focus === 'extras' && extraCursor === 0}
            selected={addNewline}
            marker={addNewline ? '[✓]' : '[ ]'}
            indent={1}
            label="Blank line before prompt"
            hint="Space toggles · starship add_newline"
          />
          <PickerRow
            focused={focus === 'extras' && extraCursor === 1}
            selected={vimMode}
            marker={vimMode ? '[✓]' : '[ ]'}
            indent={1}
            label="Vim mode symbol"
            hint="Shows ❮ in vim normal mode (cmd, fish, zsh)"
          />
        </Box>
      </Box>

      <NavHints
        hints={[
          { key: '↑↓', label: 'navigate' },
          { key: 'Tab', label: 'switch section' },
          { key: 'Space', label: 'toggle' },
          { key: 'Enter', label: 'confirm' },
          { key: 'Esc', label: 'back' },
        ]}
      />
    </WizardLayout>
  );
}
