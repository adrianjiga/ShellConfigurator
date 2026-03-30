import React from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { WizardState } from '../types.js';
import { NERD_FONTS } from '../services/installer.js';
import { WizardLayout } from '../components/WizardLayout.js';
import { NavHints } from '../components/NavHints.js';

interface FontSelectScreenProps {
  state: WizardState;
  onNext: (update: Partial<WizardState>) => void;
  onBack: () => void;
}

export function FontSelectScreen({ state, onNext, onBack }: FontSelectScreenProps) {
  useInput((_, key) => {
    if (key.escape) onBack();
  });

  const items = NERD_FONTS.map((f) => ({ label: f.label, value: f.id }));

  return (
    <WizardLayout state={state}>
      <Box flexDirection="column" gap={1}>
        <Text bold>Choose a Nerd Font to install</Text>
        <Text color="gray">
          The font will be downloaded from GitHub and installed to{' '}
          <Text color="cyan">~/.local/share/fonts/</Text>
        </Text>
        <Text color="gray" italic>
          You'll need to set this font in your terminal emulator settings after installing.
        </Text>

        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(item) =>
              onNext({ nerdFontToInstall: item.value as string, hasNerdFont: true })
            }
          />
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
