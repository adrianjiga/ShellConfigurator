import { Box, Text, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';
import { NavHints } from '../components/NavHints.tsx';
import { PickerRow } from '../components/PickerRow.tsx';
import { WizardLayout } from '../components/WizardLayout.tsx';
import { uiColor } from '../config/colors.ts';
import {
  type ConfigurableModuleId,
  MODULES,
  type ModuleDef,
  type ModuleId,
} from '../config/modules.ts';
import type { WizardState } from '../types.ts';

interface SegmentsScreenProps {
  state: WizardState;
  side: 'left' | 'right';
  onNext: (update: Partial<WizardState>) => void;
  onUpdate: (update: Partial<WizardState>) => void;
  onBack: () => void;
}

interface Row {
  id: ConfigurableModuleId;
  selected: boolean;
  taken: boolean;
}

const MODULE_BY_ID = new Map<ConfigurableModuleId, ModuleDef>(MODULES.map((mod) => [mod.id, mod]));

const CHECKED = '[✓]';
const UNCHECKED = '[ ]';
const TAKEN = '[–]';

function matchesFilter(mod: ModuleDef, filter: string): boolean {
  if (!filter) return true;
  const needle = filter.toLowerCase();
  return mod.label.toLowerCase().includes(needle) || mod.description.toLowerCase().includes(needle);
}

/**
 * Selected modules first, in prompt order, then everything still available.
 * Keeping the two groups distinct is what makes reordering visible: moving a
 * row with Shift+↑/↓ changes the order it is rendered in.
 */
function buildRows(
  selected: ConfigurableModuleId[],
  filter: string,
  takenByLeft: ReadonlySet<string>
): Row[] {
  const selectedSet = new Set(selected);
  const selectedRows: Row[] = [];
  for (const id of selected) {
    const mod = MODULE_BY_ID.get(id);
    if (mod && matchesFilter(mod, filter)) {
      selectedRows.push({ id, selected: true, taken: false });
    }
  }

  const availableRows: Row[] = [];
  for (const mod of MODULES) {
    if (selectedSet.has(mod.id) || !matchesFilter(mod, filter)) continue;
    availableRows.push({ id: mod.id, selected: false, taken: takenByLeft.has(mod.id) });
  }

  return [...selectedRows, ...availableRows];
}

export function SegmentsScreen({ state, side, onNext, onUpdate, onBack }: SegmentsScreenProps) {
  const currentModules = side === 'left' ? state.leftModules : state.rightModules;

  // A module already on the left cannot also go on the right — it would render twice.
  const takenByLeft = new Set<string>(side === 'right' ? state.leftModules : []);

  const [selected, setSelected] = useState<ConfigurableModuleId[]>(() =>
    currentModules.filter((id): id is ConfigurableModuleId => id !== 'character')
  );
  const [filter, setFilter] = useState('');
  const [cursor, setCursor] = useState(0);
  const isInitialMount = useRef(true);

  const rows = buildRows(selected, filter, takenByLeft);

  const applyModules = (commit: (update: Partial<WizardState>) => void, modules: ModuleId[]) => {
    // A module moved to the left leaves the right, so it never renders twice.
    const update =
      side === 'left'
        ? {
            leftModules: modules,
            rightModules: state.rightModules.filter((id) => !modules.includes(id)),
          }
        : { rightModules: modules };
    commit(update);
  };

  const orderedForSide = (): ModuleId[] =>
    side === 'left' ? [...selected, 'character'] : selected;

  // Push live updates to parent state so preview stays in sync (skip initial mount)
  // onUpdate is a fresh closure each parent render; including it would loop on every state push.
  // biome-ignore lint/correctness/useExhaustiveDependencies: onUpdate loops on every state push.
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    applyModules(onUpdate, orderedForSide());
  }, [selected, side]);

  // The list shrinks as the filter narrows, so keep the cursor inside it.
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, rows.length - 1)));
  }, [rows.length]);

  function saveAndProceed() {
    applyModules(onNext, orderedForSide());
  }

  function moveCursor(delta: number) {
    setCursor((c) => Math.min(Math.max(0, c + delta), Math.max(0, rows.length - 1)));
  }

  function toggleRow() {
    const row = rows[cursor];
    if (!row || row.taken) return;

    const nextSelected = row.selected
      ? selected.filter((id) => id !== row.id)
      : [...selected, row.id];
    setSelected(nextSelected);

    // Follow the row into its new group instead of leaving the cursor behind.
    const nextRows = buildRows(nextSelected, filter, takenByLeft);
    setCursor(
      Math.max(
        0,
        nextRows.findIndex((r) => r.id === row.id)
      )
    );
  }

  function reorderRow(delta: -1 | 1) {
    const row = rows[cursor];
    if (!row?.selected) return;

    const from = selected.indexOf(row.id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= selected.length) return;

    const nextSelected = [...selected];
    [nextSelected[from], nextSelected[to]] = [nextSelected[to]!, nextSelected[from]!];
    setSelected(nextSelected);

    const nextRows = buildRows(nextSelected, filter, takenByLeft);
    setCursor(
      Math.max(
        0,
        nextRows.findIndex((r) => r.id === row.id)
      )
    );
  }

  useInput((char, key) => {
    if (key.escape) {
      // First Escape clears a search; a second one leaves the screen.
      if (filter) {
        setFilter('');
        return;
      }
      onBack();
      return;
    }

    if (key.leftArrow) {
      onBack();
      return;
    }

    if (key.upArrow) {
      if (key.shift || key.ctrl) reorderRow(-1);
      else moveCursor(-1);
      return;
    }

    if (key.downArrow) {
      if (key.shift || key.ctrl) reorderRow(1);
      else moveCursor(1);
      return;
    }

    if (key.backspace || key.delete) {
      setFilter((f) => f.slice(0, -1));
      return;
    }

    if (char === ' ') {
      toggleRow();
      return;
    }

    if (key.return || key.tab || key.rightArrow) {
      saveAndProceed();
      return;
    }

    // Everything printable narrows the list. Control and meta combos are not text.
    if (char && !key.ctrl && !key.meta) {
      setFilter((f) => f + char);
    }
  });

  return (
    <WizardLayout state={state}>
      <Box flexDirection="column" gap={1}>
        <Text bold>{side === 'left' ? 'Left prompt segments' : 'Right prompt segments'}</Text>
        <Text color={uiColor('gray')}>
          {side === 'left'
            ? 'Choose which info appears on the left of your prompt.'
            : 'Choose which info appears on the right (optional — press Enter to skip).'}
        </Text>
        {side === 'left' && (
          <Text color={uiColor('gray')} italic>
            The prompt character (❯ λ $) is always shown at the end.
          </Text>
        )}

        <Box flexDirection="row" gap={1}>
          <Text color={uiColor('gray')}>Filter:</Text>
          <Text color={uiColor(filter ? 'white' : 'gray')}>{filter || 'type to search'}</Text>
          <Text color={uiColor('cyan')}>▌</Text>
        </Box>

        <Box flexDirection="column">
          {rows.length === 0 && <Text color={uiColor('yellow')}>No modules match “{filter}”.</Text>}
          {rows.map((row, i) => {
            const mod = MODULE_BY_ID.get(row.id)!;
            const showHeading = i === 0 || rows[i - 1]!.selected !== row.selected;
            const position = selected.indexOf(row.id) + 1;
            const marker = row.taken ? TAKEN : row.selected ? CHECKED : UNCHECKED;

            return (
              <Box key={row.id} flexDirection="column">
                {showHeading && (
                  <Text color={uiColor('gray')} bold>
                    {row.selected ? 'Prompt order' : 'Available'}
                  </Text>
                )}
                <PickerRow
                  focused={i === cursor}
                  selected={row.selected}
                  disabled={row.taken}
                  marker={marker}
                  label={row.selected ? `${position}. ${mod.label}` : mod.label}
                  suffix={
                    row.taken ? (
                      <Text color={uiColor('gray')} italic>
                        — already on the left
                      </Text>
                    ) : undefined
                  }
                  hint={mod.description}
                />
              </Box>
            );
          })}
        </Box>
      </Box>

      <NavHints
        hints={[
          { key: '↑↓', label: 'navigate' },
          { key: 'Space', label: 'toggle' },
          { key: 'Shift+↑↓', label: 'reorder' },
          { key: 'Enter/Tab/→', label: side === 'right' ? 'confirm / skip' : 'next' },
          { key: 'Esc/←', label: 'back' },
        ]}
      />
    </WizardLayout>
  );
}
