import { Box, Text, useInput } from 'ink';
import { AppSelectInput } from '../components/AppSelectInput.tsx';
import { LIST_HINTS, NavHints } from '../components/NavHints.tsx';
import { WizardLayout } from '../components/WizardLayout.tsx';
import { uiColor } from '../config/colors.ts';
import { getNerdFontsDir, NERD_FONTS } from '../services/installer.ts';
import { TERMINAL_LABELS } from '../services/terminalFont.ts';
import type { WizardState } from '../types.ts';

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
  const chosen = state.nerdFontToInstall;
  const initialIndex =
    chosen.kind === 'install'
      ? Math.max(
          0,
          items.findIndex((i) => i.value === chosen.id)
        )
      : 0;

  return (
    <WizardLayout state={state}>
      <Box flexDirection="column" gap={1}>
        <Text bold>Choose a Nerd Font to install</Text>
        <Text color={uiColor('gray')}>
          The font will be downloaded from GitHub and installed to{' '}
          <Text color={uiColor('cyan')}>{getNerdFontsDir()}</Text>
        </Text>
        <Text color={uiColor('gray')} italic>
          {state.terminal && state.terminal !== 'wezterm'
            ? `It will also be selected in ${TERMINAL_LABELS[state.terminal]} for you.`
            : "You'll need to set this font in your terminal emulator settings after installing."}
        </Text>

        <Box marginTop={1}>
          <AppSelectInput
            items={items}
            initialIndex={initialIndex}
            onSelect={(item) =>
              onNext({ nerdFontToInstall: { kind: 'install', id: item.value }, hasNerdFont: true })
            }
          />
        </Box>
      </Box>

      <NavHints hints={LIST_HINTS} />
    </WizardLayout>
  );
}
