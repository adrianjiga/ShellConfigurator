import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { uiColor } from '../config/colors.ts';

interface PickerRowProps {
  label: string;
  /** The section has focus and this row is under the cursor. */
  focused?: boolean;
  /** This row is the current value (Style) or checked (Segments). */
  selected?: boolean;
  /** Checkbox-style marker shown before the label, e.g. `[✓]`. */
  marker?: string;
  /** The row cannot be chosen — e.g. already used by the other prompt side. */
  disabled?: boolean;
  /** Left margin for the row and its hint (Style indents its lists by 1). */
  indent?: number;
  /** Content after the label on the same line — swatches, inline notes. */
  suffix?: ReactNode;
  /** Help text on its own line, shown only while the row is focused. */
  hint?: string;
}

/**
 * One row of a single-choice or multi-choice picker: cursor marker, optional
 * checkbox, label, and optional inline suffix/hint. Shared by the Style and
 * Segments screens so the three lists look and behave identically.
 */
export function PickerRow({
  label,
  focused = false,
  selected = false,
  marker,
  disabled = false,
  indent = 0,
  suffix,
  hint,
}: PickerRowProps) {
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1} marginLeft={indent}>
        <Text color={uiColor(focused ? 'cyan' : 'gray')}>{focused ? '›' : ' '}</Text>
        {marker !== undefined && (
          <Text color={uiColor(disabled ? 'gray' : selected ? 'green' : 'gray')}>{marker}</Text>
        )}
        <Text
          color={uiColor(disabled ? 'gray' : 'white')}
          bold={(selected || focused) && !disabled}
          dimColor={disabled}
        >
          {label}
        </Text>
        {suffix}
      </Box>
      {focused && hint && (
        <Box marginLeft={indent + 4}>
          <Text color={uiColor('gray')} italic>
            {hint}
          </Text>
        </Box>
      )}
    </Box>
  );
}
