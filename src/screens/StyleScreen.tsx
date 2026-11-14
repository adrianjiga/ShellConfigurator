import { Box, Text, useInput } from 'ink';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { NavHints } from '../components/NavHints.tsx';
import { PickerRow } from '../components/PickerRow.tsx';
import { WizardLayout } from '../components/WizardLayout.tsx';
import { colorsEnabled, uiColor } from '../config/colors.ts';
import {
  clampTruncationLength,
  formatSubstitutions,
  parseSubstitutions,
} from '../config/directory.ts';
import { inkColor, PALETTES, type PaletteColorName, type PaletteId } from '../config/palettes.ts';
import { errorMessage } from '../services/errors.ts';
import type {
  CharacterSymbol,
  ContinuationPrompt,
  DirectorySubstitution,
  WizardState,
} from '../types.ts';

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

const CHAR_VALUES = CHAR_OPTIONS.map((o) => o.value);
const PALETTE_IDS = PALETTES.map((p) => p.id);
const POWERLINE_VALUES = POWERLINE_OPTIONS.map((o) => o.value);
const CONTINUATION_VALUES = CONTINUATION_OPTIONS.map((o) => o.value);

type FocusSection = 'char' | 'color' | 'powerline' | 'continuation' | 'extras' | 'directory';

const FOCUS_ORDER: FocusSection[] = [
  'char',
  'color',
  'powerline',
  'continuation',
  'extras',
  'directory',
];

/** The checkbox rows in the "Prompt extras" section, top to bottom. */
const EXTRA_ROWS = ['addNewline', 'vimMode'] as const;
type ExtraRow = (typeof EXTRA_ROWS)[number];

/**
 * useState whose setter also updates a ref at once. Ink can deliver several keys
 * from one input chunk before re-rendering, so key handlers read the ref.
 */
function useLive<T>(initial: T) {
  const [value, setValue] = useState<T>(initial);
  const ref = useRef(value);
  const set = (next: T | ((prev: T) => T)) => {
    ref.current = typeof next === 'function' ? (next as (prev: T) => T)(ref.current) : next;
    setValue(ref.current);
  };
  return [value, set, ref] as const;
}

/** The option `delta` steps away from `current`, clamped to the list. */
function step<T>(options: readonly T[], current: T, delta: number): T {
  const index = options.indexOf(current);
  return options[Math.min(options.length - 1, Math.max(0, index + delta))]!;
}

/**
 * One Style section: only the focused one lists its options, the rest show a
 * one-line summary, so the screen fits a normal-height terminal.
 */
function Section({
  title,
  focused,
  summary,
  children,
}: {
  title: string;
  focused: boolean;
  summary: string;
  children: ReactNode;
}) {
  return (
    <Box flexDirection="column">
      <Text color={uiColor(focused ? 'cyan' : 'gray')} bold={focused}>
        {focused ? title : `${title}: ${summary}`}
      </Text>
      {focused && children}
    </Box>
  );
}

function depthLabel(value: number): string {
  if (value === 0) return 'Full path';
  return `${value} folder${value === 1 ? '' : 's'}`;
}

export function StyleScreen({ state, onNext, onUpdate, onBack }: StyleScreenProps) {
  const [characterSymbol, setCharacterSymbol, characterSymbolRef] = useLive<CharacterSymbol>(
    state.characterSymbol
  );
  const [palette, setPalette, paletteRef] = useLive<PaletteId>(state.palette);
  const [powerline, setPowerline, powerlineRef] = useLive<boolean>(state.powerline);
  const [continuationPrompt, setContinuationPrompt, continuationPromptRef] =
    useLive<ContinuationPrompt>(state.continuationPrompt);
  const [addNewline, setAddNewline, addNewlineRef] = useLive<boolean>(state.addNewline);
  const [vimMode, setVimMode, vimModeRef] = useLive<boolean>(state.vimMode);
  const [directoryTruncationLength, setDirectoryTruncationLength, directoryTruncationLengthRef] =
    useLive<number>(state.directoryTruncationLength);
  const [directorySubstitutions, setDirectorySubstitutions, directorySubstitutionsRef] = useLive<
    DirectorySubstitution[]
  >(state.directorySubstitutions);
  const [focus, setFocus, focusRef] = useLive<FocusSection>('char');
  const [extraCursor, setExtraCursor, extraCursorRef] = useLive(0);
  const [dirCursor, setDirCursor, dirCursorRef] = useLive(0);
  const [editingSubs, setEditingSubs, editingSubsRef] = useLive(false);
  const [subsDraft, setSubsDraft, subsDraftRef] = useLive('');
  const [subsError, setSubsError] = useState<string | null>(null);
  const isInitialMount = useRef(true);

  const charIdx = CHAR_OPTIONS.findIndex((o) => o.value === characterSymbol);
  const colorIdx = PALETTES.findIndex((o) => o.id === palette);
  const powerlineIdx = POWERLINE_OPTIONS.findIndex((o) => o.value === powerline);
  const continuationIdx = CONTINUATION_OPTIONS.findIndex((o) => o.value === continuationPrompt);

  const selection = (): Partial<WizardState> => ({
    characterSymbol: characterSymbolRef.current,
    palette: paletteRef.current,
    powerline: powerlineRef.current,
    continuationPrompt: continuationPromptRef.current,
    addNewline: addNewlineRef.current,
    vimMode: vimModeRef.current,
    directoryTruncationLength: directoryTruncationLengthRef.current,
    directorySubstitutions: directorySubstitutionsRef.current,
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
  }, [
    characterSymbol,
    palette,
    powerline,
    continuationPrompt,
    addNewline,
    vimMode,
    directoryTruncationLength,
    directorySubstitutions,
  ]);

  function toggleExtra(row: ExtraRow) {
    if (row === 'addNewline') setAddNewline((v) => !v);
    else setVimMode((v) => !v);
  }

  function startEditingSubs() {
    setSubsDraft(formatSubstitutions(directorySubstitutionsRef.current));
    setSubsError(null);
    setEditingSubs(true);
  }

  function commitSubs() {
    try {
      setDirectorySubstitutions(parseSubstitutions(subsDraftRef.current));
      setSubsError(null);
      setEditingSubs(false);
    } catch (error) {
      setSubsError(errorMessage(error));
    }
  }

  useInput((char, key) => {
    // The substitution editor owns the keyboard while it is open, so typed text
    // or an arrow cannot navigate the wizard underneath it.
    if (editingSubsRef.current) {
      if (key.escape) {
        setEditingSubs(false);
        setSubsError(null);
        return;
      }
      if (key.return) {
        commitSubs();
        return;
      }
      // Editing the draft clears the error the last attempt left.
      if (key.backspace || key.delete) {
        setSubsDraft((d) => d.slice(0, -1));
        setSubsError(null);
        return;
      }
      // A pasted line break is dropped rather than put into the draft.
      const text = char.replace(/[\r\n]/g, '');
      if (text && !key.ctrl && !key.meta) {
        setSubsDraft((d) => d + text);
        setSubsError(null);
      }
      return;
    }

    if (key.escape) {
      onBack();
      return;
    }

    if (key.tab) {
      const delta = key.shift ? FOCUS_ORDER.length - 1 : 1;
      setFocus((f) => FOCUS_ORDER[(FOCUS_ORDER.indexOf(f) + delta) % FOCUS_ORDER.length]!);
      return;
    }

    const focused = focusRef.current;

    // On the substitutions row, Enter opens the editor instead of confirming.
    if (focused === 'directory' && dirCursorRef.current === 1 && key.return) {
      startEditingSubs();
      return;
    }

    if (key.return) {
      onNext(selection());
      return;
    }

    const delta = key.upArrow ? -1 : key.downArrow ? 1 : 0;
    if (focused === 'char') {
      if (delta) setCharacterSymbol((v) => step(CHAR_VALUES, v, delta));
    } else if (focused === 'color') {
      if (delta) setPalette((v) => step(PALETTE_IDS, v, delta));
    } else if (focused === 'powerline') {
      if (delta) setPowerline((v) => step(POWERLINE_VALUES, v, delta));
    } else if (focused === 'continuation') {
      if (delta) setContinuationPrompt((v) => step(CONTINUATION_VALUES, v, delta));
    } else if (focused === 'extras') {
      if (delta) setExtraCursor((i) => Math.min(EXTRA_ROWS.length - 1, Math.max(0, i + delta)));
      if (char === ' ') toggleExtra(EXTRA_ROWS[extraCursorRef.current]!);
    } else {
      if (delta) setDirCursor((i) => Math.min(1, Math.max(0, i + delta)));
      if (dirCursorRef.current === 0) {
        if (key.leftArrow) {
          setDirectoryTruncationLength((v) => clampTruncationLength(v - 1));
        }
        if (key.rightArrow) {
          setDirectoryTruncationLength((v) => clampTruncationLength(v + 1));
        }
      }
    }
  });

  return (
    <WizardLayout state={state}>
      <Box flexDirection="column" gap={1}>
        <Text bold>Style options</Text>

        <Section
          title="Prompt character"
          focused={focus === 'char'}
          summary={`${CHAR_OPTIONS[charIdx]!.preview} ${CHAR_OPTIONS[charIdx]!.label}`}
        >
          {CHAR_OPTIONS.map((opt, i) => (
            <PickerRow
              key={opt.value}
              focused={i === charIdx}
              selected={i === charIdx}
              indent={1}
              label={`${opt.preview} ${opt.label}`}
            />
          ))}
        </Section>

        <Section
          title="Colour palette"
          focused={focus === 'color'}
          summary={PALETTES[colorIdx]!.label}
        >
          {PALETTES.map((opt, i) => (
            <PickerRow
              key={opt.id}
              focused={i === colorIdx}
              selected={i === colorIdx}
              indent={1}
              label={opt.label}
              // A swatch of the palette's own colours, so the list shows what it
              // is describing rather than only naming it. Without colour the dots
              // are indistinguishable, so leave them out entirely.
              suffix={
                colorsEnabled()
                  ? SWATCH_COLORS.map((name) => (
                      <Text key={name} color={uiColor(inkColor(opt.colors[name]))}>
                        ●
                      </Text>
                    ))
                  : undefined
              }
            />
          ))}
        </Section>

        <Section
          title="Segment style"
          focused={focus === 'powerline'}
          summary={POWERLINE_OPTIONS[powerlineIdx]!.label}
        >
          {POWERLINE_OPTIONS.map((opt, i) => (
            <PickerRow
              key={opt.label}
              focused={i === powerlineIdx}
              selected={i === powerlineIdx}
              indent={1}
              label={opt.label}
              suffix={
                <Text color={uiColor('gray')} italic>
                  — {opt.description}
                </Text>
              }
            />
          ))}
        </Section>
        {powerline && !state.hasNerdFont && (
          <Text color={uiColor('yellow')}>
            {'  '}Powerline separators need a Nerd Font — a plain prompt will be generated instead.
          </Text>
        )}

        <Section
          title="Wrapped-line marker (fish has none)"
          focused={focus === 'continuation'}
          summary={CONTINUATION_OPTIONS[continuationIdx]!.label}
        >
          {CONTINUATION_OPTIONS.map((opt, i) => (
            <PickerRow
              key={opt.value}
              focused={i === continuationIdx}
              selected={i === continuationIdx}
              indent={1}
              label={opt.label}
              suffix={
                <Text color={uiColor('gray')} italic>
                  — {opt.description}
                </Text>
              }
            />
          ))}
        </Section>

        <Section
          title="Prompt extras"
          focused={focus === 'extras'}
          summary={
            [addNewline && 'blank line', vimMode && 'vim symbol'].filter(Boolean).join(', ') ||
            'none'
          }
        >
          <PickerRow
            focused={extraCursor === 0}
            selected={addNewline}
            marker={addNewline ? '[✓]' : '[ ]'}
            indent={1}
            label="Blank line before prompt"
            hint="Space toggles · starship add_newline"
          />
          <PickerRow
            focused={extraCursor === 1}
            selected={vimMode}
            marker={vimMode ? '[✓]' : '[ ]'}
            indent={1}
            label="Vim mode symbol"
            hint="Marks vim normal mode (cmd, fish and zsh only)"
          />
        </Section>

        <Section
          title="Directory display"
          focused={focus === 'directory'}
          summary={`${depthLabel(directoryTruncationLength)}, ${
            directorySubstitutions.length > 0
              ? `${directorySubstitutions.length} substitution(s)`
              : 'no substitutions'
          }`}
        >
          <PickerRow
            focused={dirCursor === 0}
            indent={1}
            label={`Depth: ${depthLabel(directoryTruncationLength)}`}
            hint="←→ adjusts · 0 shows the full path"
          />
          <PickerRow
            focused={dirCursor === 1}
            indent={1}
            label={
              directorySubstitutions.length > 0
                ? `Substitutions: ${formatSubstitutions(directorySubstitutions)}`
                : 'Substitutions: none'
            }
            hint="Enter to edit · from=to, comma separated"
          />
          {editingSubs && (
            <Box flexDirection="column" marginLeft={2}>
              <Text color={uiColor('cyan')}>
                {'> '}
                {subsDraft}
                <Text color={uiColor('cyan')}>▌</Text>
              </Text>
              {subsError ? (
                <Text color={uiColor('red')}>{subsError}</Text>
              ) : (
                <Text color={uiColor('gray')} italic>
                  Enter saves · Esc cancels
                </Text>
              )}
            </Box>
          )}
        </Section>
      </Box>

      <NavHints
        hints={
          editingSubs
            ? [
                { key: 'Enter', label: 'save' },
                { key: 'Esc', label: 'cancel' },
              ]
            : [
                { key: '↑↓', label: 'navigate' },
                { key: 'Tab/Shift+Tab', label: 'switch section' },
                ...(focus === 'extras' ? [{ key: 'Space', label: 'toggle' }] : []),
                ...(focus === 'directory' && dirCursor === 0
                  ? [{ key: '←→', label: 'depth' }]
                  : []),
                focus === 'directory' && dirCursor === 1
                  ? { key: 'Enter', label: 'edit' }
                  : { key: 'Enter', label: 'confirm' },
                { key: 'Esc', label: 'back' },
              ]
        }
      />
    </WizardLayout>
  );
}
