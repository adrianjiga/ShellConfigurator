import { Box, Text } from 'ink';
import { uiColor } from '../config/colors.ts';

interface Hint {
  key: string;
  label: string;
}

/** The bar under a plain option list. */
export const LIST_HINTS: readonly Hint[] = [
  { key: '↑↓', label: 'navigate' },
  { key: 'Enter/1-9', label: 'select' },
  { key: 'Esc', label: 'back' },
];

interface NavHintsProps {
  hints: readonly Hint[];
}

export function NavHints({ hints }: NavHintsProps) {
  return (
    <Box marginTop={1}>
      {hints.map((h) => (
        <Box key={h.key + h.label} marginRight={2}>
          <Text bold color={uiColor('cyan')}>
            {h.key}
          </Text>
          <Text color={uiColor('gray')}> {h.label}</Text>
        </Box>
      ))}
    </Box>
  );
}
