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
  {
    label: 'Yes, I already have one',
    value: 'have',
  },
  {
    label: 'No, install one for me',
    value: 'install',
  },
  {
    label: 'No, use text symbols only',
    value: 'none',
  },
];

export function FontCheckScreen({ state, onNext, onBack }: FontCheckScreenProps) {
  useInput((_, key) => {
    if (key.escape) onBack();
  });

  function handleSelect(item: { value: string }) {
    switch (item.value) {
      case 'have':
        onNext({ hasNerdFont: true, nerdFontToInstall: null });
        break;
      case 'install':
        // app.tsx will route to font_select step
        onNext({ hasNerdFont: true, nerdFontToInstall: '__select__' });
        break;
      case 'none':
        onNext({ hasNerdFont: false, nerdFontToInstall: null });
        break;
    }
  }

  return (
    <WizardLayout state={state}>
      <Box flexDirection="column" gap={1}>
        <Text bold>Nerd Font check</Text>
        <Text color="gray">
          Nerd Fonts add icons to your prompt. Do any of these render as icons?
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
            <Text color="gray">folder icon</Text>
          </Box>
          <Box flexDirection="row" gap={2}>
            <Text> </Text>
            <Text color="gray">git branch icon</Text>
          </Box>
          <Box flexDirection="row" gap={2}>
            <Text> </Text>
            <Text color="gray">node.js icon</Text>
          </Box>
          <Box flexDirection="row" gap={2}>
            <Text> </Text>
            <Text color="gray">python icon</Text>
          </Box>
        </Box>

        <Box marginTop={1}>
          <SelectInput items={items} onSelect={handleSelect} />
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
