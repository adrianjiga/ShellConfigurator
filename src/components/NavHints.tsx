import React from 'react';
import { Box, Text } from 'ink';

interface Hint {
  key: string;
  label: string;
}

interface NavHintsProps {
  hints: Hint[];
}

export function NavHints({ hints }: NavHintsProps) {
  return (
    <Box marginTop={1}>
      {hints.map((h) => (
        <Box key={h.key + h.label} marginRight={2}>
          <Text bold color="cyan">
            {h.key}
          </Text>
          <Text color="gray"> {h.label}</Text>
        </Box>
      ))}
    </Box>
  );
}
