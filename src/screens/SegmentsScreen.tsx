import { Box, Text, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';
import { NavHints } from '../components/NavHints.tsx';
import { WizardLayout } from '../components/WizardLayout.tsx';
import { type ConfigurableModuleId, MODULES, type ModuleId } from '../config/modules.ts';
import type { WizardState } from '../types.ts';

interface SegmentsScreenProps {
  state: WizardState;
  side: 'left' | 'right';
  onNext: (update: Partial<WizardState>) => void;
  onUpdate: (update: Partial<WizardState>) => void;
  onBack: () => void;
}

// 'character' is always added automatically at the end of the left prompt and is
// not a ConfigurableModuleId, so MODULES already excludes it.
const CONFIGURABLE = MODULES;

function orderedModules(enabled: Set<ConfigurableModuleId>): ModuleId[] {
  return CONFIGURABLE.filter((m) => enabled.has(m.id)).map((m) => m.id);
}

export function SegmentsScreen({ state, side, onNext, onUpdate, onBack }: SegmentsScreenProps) {
  const currentModules = side === 'left' ? state.leftModules : state.rightModules;

  // A module already on the left cannot also go on the right — it would render twice.
  const takenByLeft = new Set<string>(side === 'right' ? state.leftModules : []);

  const [enabled, setEnabled] = useState<Set<ConfigurableModuleId>>(
    () => new Set(currentModules.filter((m) => m !== 'character'))
  );
  const [cursor, setCursor] = useState(0);
  const isInitialMount = useRef(true);

  // Push live updates to parent state so preview stays in sync (skip initial mount)
  // onUpdate is a fresh closure each parent render; including it would loop on every state push.
  // biome-ignore lint/correctness/useExhaustiveDependencies: onUpdate loops on every state push.
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    const ordered = orderedModules(enabled);
    const modules: ModuleId[] = side === 'left' ? [...ordered, 'character'] : ordered;
    if (side === 'left') {
      onUpdate({ leftModules: modules });
    } else {
      onUpdate({ rightModules: modules });
    }
  }, [enabled, side]);

  function saveAndProceed() {
    const ordered = orderedModules(enabled);
    const modules: ModuleId[] = side === 'left' ? [...ordered, 'character'] : ordered;
    if (side === 'left') {
      onNext({ leftModules: modules });
    } else {
      onNext({ rightModules: modules });
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
      if (takenByLeft.has(id)) return;
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
            const isTaken = takenByLeft.has(mod.id);
            const isChecked = enabled.has(mod.id);
            return (
              <Box key={mod.id} flexDirection="column">
                <Box flexDirection="row" gap={1}>
                  <Text color={isActive ? 'cyan' : 'gray'}>{isActive ? '›' : ' '}</Text>
                  <Text color={isTaken ? 'gray' : isChecked ? 'green' : 'gray'}>
                    {isTaken ? '[–]' : isChecked ? '[✓]' : '[ ]'}
                  </Text>
                  <Text
                    color={isTaken ? 'gray' : isActive ? 'white' : 'gray'}
                    bold={isActive && !isTaken}
                    dimColor={isTaken}
                  >
                    {mod.label}
                  </Text>
                  {isTaken && (
                    <Text color="gray" italic>
                      {' '}
                      — already on the left
                    </Text>
                  )}
                </Box>
                {isActive && !isTaken && (
                  <Box paddingLeft={6}>
                    <Text color="gray" italic>
                      {mod.description}
                    </Text>
                  </Box>
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
          { key: 'Esc/←', label: 'back' },
        ]}
      />
    </WizardLayout>
  );
}
