import { Box, Text } from 'ink';
import SelectInput, { type IndicatorProps, type ItemProps } from 'ink-select-input';
import { uiColor } from '../config/colors.ts';

export interface SelectItem<V> {
  key?: string;
  label: string;
  value: V;
}

interface AppSelectInputProps<V> {
  items?: SelectItem<V>[];
  isFocused?: boolean;
  initialIndex?: number;
  limit?: number;
  onSelect?: (item: SelectItem<V>) => void;
  onHighlight?: (item: SelectItem<V>) => void;
}

function GatedIndicator({ isSelected }: IndicatorProps) {
  return (
    <Box marginRight={1}>
      {isSelected ? <Text color={uiColor('cyan')}>{'›'}</Text> : <Text> </Text>}
    </Box>
  );
}

function GatedItem({ isSelected, label }: ItemProps) {
  return <Text color={uiColor(isSelected ? 'cyan' : undefined)}>{label}</Text>;
}

/**
 * `ink-select-input` paints its selected row blue internally, bypassing
 * `uiColor`. This wrapper swaps in gated indicator/item components so the
 * `NO_COLOR` convention covers the whole wizard, not only its own screens.
 */
export function AppSelectInput<V>(props: AppSelectInputProps<V>) {
  return (
    <SelectInput<V> {...props} indicatorComponent={GatedIndicator} itemComponent={GatedItem} />
  );
}
