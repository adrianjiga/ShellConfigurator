import React from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { WizardState } from '../types.js';
import { WizardLayout } from '../components/WizardLayout.js';
import { NavHints } from '../components/NavHints.js';

interface FontCheckScreenProps {
  state: WizardState;
  onNext: (update: Partial<WizardState>) => void;
  onBack: () => void;
}

const items = [
  { label: 'Yes — they look like icons', value: true },
  { label: 'No — I see boxes, question marks, or nothing', value: false },
];

export function FontCheckScreen({ state, onNext, onBack }: FontCheckScreenProps) {
  useInput((_, key) => {
    if (key.escape) onBack();
  });

  return (
    <WizardLayout state={state}>
      <Box flexDirection="column" gap={1}>
        <Text bold>Nerd Font check</Text>
        <Text color="gray">
          Nerd Fonts add icons to your prompt. Can you see these symbols clearly?
        </Text>

        <Box
          borderStyle="round"
          borderColor="gray"
          paddingX={2}
          paddingY={1}
          marginTop={1}
          flexDirection="column"
          gap={1}
        >
          <Box flexDirection="row" gap={2}>
            <Text> </Text>
            <Text>folder icon</Text>
          </Box>
          <Box flexDirection="row" gap={2}>
            <Text> </Text>
            <Text>git branch icon</Text>
          </Box>
          <Box flexDirection="row" gap={2}>
            <Text> </Text>
            <Text>node.js icon</Text>
          </Box>
          <Box flexDirection="row" gap={2}>
            <Text> </Text>
            <Text>python icon</Text>
          </Box>
        </Box>

        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(item) => onNext({ hasNerdFont: item.value as boolean })}
          />
        </Box>
      </Box>

      <NavHints hints={[
        { key: '↑↓', label: 'navigate' },
        { key: 'Enter', label: 'select' },
        { key: 'Esc', label: 'back' },
      ]} />
    </WizardLayout>
  );
}
