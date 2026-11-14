import { Box, Text, useInput } from 'ink';
import { useRef, useState } from 'react';
import { NavHints } from '../components/NavHints.tsx';
import { PickerRow } from '../components/PickerRow.tsx';
import { editedText } from '../components/textInput.ts';
import { WizardLayout } from '../components/WizardLayout.tsx';
import { uiColor } from '../config/colors.ts';
import {
  type ConfigurableModuleId,
  MODULES,
  type ModuleDef,
  type ModuleId,
} from '../config/modules.ts';
import { useUpdateEffect } from '../hooks/useUpdateEffect.ts';
import type { WizardState } from '../types.ts';

interface SegmentsScreenProps {
  state: WizardState;
  side: 'left' | 'right';
  onNext: (update: Partial<WizardState>) => void;
  onUpdate: (update: Partial<WizardState>) => void;
  onBack: () => void;
}

interface SegmentsView {
  selected: ConfigurableModuleId[];
  filter: string;
  cursor: number;
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

  // Ink can deliver several keys from one input chunk before re-rendering, so the
  // handlers read and write this ref, which is always current, not the render's copy.
  const [view, setView] = useState<SegmentsView>(() => ({
    selected: currentModules.filter((id): id is ConfigurableModuleId => id !== 'character'),
    filter: '',
    cursor: 0,
  }));
  const viewRef = useRef(view);
  const { selected, filter, cursor } = view;

  const rows = buildRows(selected, filter, takenByLeft);

  function update(next: Partial<SegmentsView>) {
    viewRef.current = { ...viewRef.current, ...next };
    setView(viewRef.current);
  }

  const currentRows = () =>
    buildRows(viewRef.current.selected, viewRef.current.filter, takenByLeft);

  const applyModules = (commit: (update: Partial<WizardState>) => void, modules: ModuleId[]) => {
    // A module moved to the left leaves the right, so it never renders twice.
    const changes =
      side === 'left'
        ? {
            leftModules: modules,
            rightModules: state.rightModules.filter((id) => !modules.includes(id)),
          }
        : { rightModules: modules };
    commit(changes);
  };

  const orderedForSide = (modules: ConfigurableModuleId[]): ModuleId[] =>
    side === 'left' ? [...modules, 'character'] : modules;

  // Push live updates to parent state so preview stays in sync. onUpdate is a
  // fresh closure each parent render; including it would loop on every state push.
  useUpdateEffect(() => applyModules(onUpdate, orderedForSide(selected)), [selected, side]);

  function saveAndProceed() {
    applyModules(onNext, orderedForSide(viewRef.current.selected));
  }

  /** A new filter starts on its first match. */
  function setFilter(next: string) {
    update({ filter: next, cursor: 0 });
  }

  function moveCursor(delta: number) {
    const last = Math.max(0, currentRows().length - 1);
    update({ cursor: Math.min(Math.max(0, viewRef.current.cursor + delta), last) });
  }

  /** Follow a row into its new position instead of leaving the cursor behind. */
  function commitSelected(nextSelected: ConfigurableModuleId[], followId: ConfigurableModuleId) {
    const nextRows = buildRows(nextSelected, viewRef.current.filter, takenByLeft);
    update({
      selected: nextSelected,
      cursor: Math.max(
        0,
        nextRows.findIndex((r) => r.id === followId)
      ),
    });
  }

  function toggleRow() {
    const { selected: current, cursor: at } = viewRef.current;
    const row = currentRows()[at];
    if (!row || row.taken) return;
    commitSelected(
      row.selected ? current.filter((id) => id !== row.id) : [...current, row.id],
      row.id
    );
  }

  function reorderRow(delta: -1 | 1) {
    const { selected: current, cursor: at } = viewRef.current;
    const row = currentRows()[at];
    if (!row?.selected) return;

    const from = current.indexOf(row.id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= current.length) return;

    const nextSelected = [...current];
    [nextSelected[from], nextSelected[to]] = [nextSelected[to]!, nextSelected[from]!];
    commitSelected(nextSelected, row.id);
  }

  useInput((char, key) => {
    if (key.escape) {
      // First Escape clears a search; a second one leaves the screen.
      if (viewRef.current.filter) {
        setFilter('');
        return;
      }
      onBack();
      return;
    }

    // While a filter is typed, ← stays on the screen rather than dropping it.
    if (key.leftArrow) {
      if (!viewRef.current.filter) onBack();
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

    if (char === ' ') {
      toggleRow();
      return;
    }

    if (key.return || key.tab || key.rightArrow) {
      saveAndProceed();
      return;
    }

    // Everything typed narrows the list; Backspace widens it again.
    const next = editedText(viewRef.current.filter, char, key);
    if (next !== null) setFilter(next);
  });

  return (
    <WizardLayout state={state}>
      <Box flexDirection="column" gap={1}>
        <Text bold>{side === 'left' ? 'Left prompt segments' : 'Right prompt segments'}</Text>
        <Text color={uiColor('gray')}>
          {side === 'left'
            ? 'Choose which info appears on the left of your prompt.'
            : 'Choose which info appears on the right (optional — Enter keeps the list as it is).'}
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
          { key: 'Enter/Tab/→', label: 'next' },
          { key: 'Esc/←', label: 'back' },
        ]}
      />
    </WizardLayout>
  );
}
