import { Box, Text, useInput } from 'ink';
import { AppSelectInput } from '../components/AppSelectInput.tsx';
import { NavHints } from '../components/NavHints.tsx';
import { WizardLayout } from '../components/WizardLayout.tsx';
import { uiColor } from '../config/colors.ts';
import { NERD_FONT_SYMBOLS } from '../config/promptSymbols.ts';
import { NO_NERD_FONT, type WizardState } from '../types.ts';

interface FontCheckScreenProps {
  state: WizardState;
  onNext: (update: Partial<WizardState>) => void;
  onBack: () => void;
}

type FontChoice = 'have' | 'install' | 'none';
type Item<V> = { label: string; value: V };

const items: Item<FontChoice>[] = [
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

  function handleSelect(item: Item<FontChoice>) {
    switch (item.value) {
      case 'have':
        onNext({ hasNerdFont: true, nerdFontToInstall: NO_NERD_FONT });
        break;
      case 'install':
        onNext({ hasNerdFont: true, nerdFontToInstall: { kind: 'select' } });
        break;
      case 'none':
        onNext({ hasNerdFont: false, nerdFontToInstall: NO_NERD_FONT });
        break;
    }
  }

  return (
    <WizardLayout state={state}>
      <Box flexDirection="column" gap={1}>
        <Text bold>Nerd Font check</Text>
        <Text color={uiColor('gray')}>
          Nerd Fonts add icons to your prompt. Do any of these render as icons?
        </Text>

        <Box
          borderStyle="round"
          borderColor={uiColor('gray')}
          paddingX={2}
          paddingY={1}
          marginTop={1}
          flexDirection="column"
          gap={1}
        >
          <Box flexDirection="row" gap={2}>
            <Text color={uiColor('white')}>{NERD_FONT_SYMBOLS.directory}</Text>
            <Text color={uiColor('gray')}>folder icon</Text>
          </Box>
          <Box flexDirection="row" gap={2}>
            <Text color={uiColor('white')}>{NERD_FONT_SYMBOLS.gitBranch}</Text>
            <Text color={uiColor('gray')}>git branch icon</Text>
          </Box>
          <Box flexDirection="row" gap={2}>
            <Text color={uiColor('white')}>{NERD_FONT_SYMBOLS.nodejs}</Text>
            <Text color={uiColor('gray')}>node.js icon</Text>
          </Box>
          <Box flexDirection="row" gap={2}>
            <Text color={uiColor('white')}>{NERD_FONT_SYMBOLS.python}</Text>
            <Text color={uiColor('gray')}>python icon</Text>
          </Box>
        </Box>

        <Box marginTop={1}>
          <AppSelectInput items={items} onSelect={handleSelect} />
        </Box>
      </Box>

      <NavHints
        hints={[
          { key: '↑↓', label: 'navigate' },
          { key: 'Enter/1-9', label: 'select' },
          { key: 'Esc', label: 'back' },
        ]}
      />
    </WizardLayout>
  );
}
