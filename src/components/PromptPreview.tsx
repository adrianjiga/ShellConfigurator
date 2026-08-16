import React from 'react';
import { Box, Text } from 'ink';
import { WizardState, CharacterSymbol } from '../types.ts';
import { getModule, type ConfigurableModuleId, type ModuleId } from '../config/modules.ts';
import { getPalette, inkColor, type PaletteColorName } from '../config/palettes.ts';

const CHAR_SYMBOLS: Record<CharacterSymbol, { success: string; error: string }> = {
  arrow: { success: '❯', error: '❯' },
  lambda: { success: 'λ', error: 'λ' },
  dollar: { success: '$', error: '$' },
};

/** The same separators the generator emits (U+E0B0 / U+E0B2). */
const SEPARATOR_RIGHT = '\ue0b0';
const SEPARATOR_LEFT = '\ue0b2';

interface PromptPreviewProps {
  state: WizardState;
}

export function PromptPreview({ state }: PromptPreviewProps) {
  const { leftModules, rightModules, hasNerdFont, characterSymbol } = state;
  const palette = getPalette(state.palette);
  // Mirrors the generator: separators are Nerd Font glyphs, so without one the
  // preview must show the plain prompt that will actually be written.
  const powerline = state.powerline && hasNerdFont;

  const color = (name: PaletteColorName) => inkColor(palette.colors[name]);

  const isSegment = (id: ModuleId): id is ConfigurableModuleId => id !== 'character';

  function renderCharacter() {
    return (
      <Text key="character" color={color('ok')} bold>
        {CHAR_SYMBOLS[characterSymbol].success}{' '}
      </Text>
    );
  }

  /**
   * Renders one side of the prompt. In powerline mode each segment is a coloured
   * block followed (or preceded) by a separator tinted with its neighbour's
   * colour, which is the same interlocking the generator writes into the config.
   */
  function renderSide(ids: ModuleId[], side: 'left' | 'right') {
    const segments = ids.filter(isSegment);

    return segments.flatMap((id, i) => {
      const def = getModule(id);
      if (!def) return [];

      const text = def.previewSegment(hasNerdFont);
      if (!powerline) {
        return [
          <Text key={id} color={color(def.id)}>
            {text}{' '}
          </Text>,
        ];
      }

      const neighbour = segments[side === 'left' ? i + 1 : i - 1];
      const neighbourColor = neighbour ? color(neighbour) : undefined;
      const block = (
        <Text key={`${id}-block`} color={color('fg')} backgroundColor={color(def.id)} bold>
          {' '}
          {text}{' '}
        </Text>
      );
      const separator = (
        <Text key={`${id}-sep`} color={color(def.id)} backgroundColor={neighbourColor}>
          {side === 'left' ? SEPARATOR_RIGHT : SEPARATOR_LEFT}
        </Text>
      );

      return side === 'left' ? [block, separator] : [separator, block];
    });
  }

  const leftSegmentCount = leftModules.filter(isSegment).length;

  return (
    <Box flexDirection="column">
      <Text bold color="gray">
        Preview
      </Text>
      <Box borderStyle="round" borderColor="gray" padding={1} flexDirection="column" marginTop={1}>
        {/* Simulated previous command output */}
        <Text color="gray">$ some-command</Text>
        <Text color="gray">output line...</Text>
        <Box height={1} />

        {/* Left prompt */}
        <Box flexDirection="row" flexWrap="wrap">
          {renderSide(leftModules, 'left')}
        </Box>

        {/* The prompt character sits on its own line, as in the generated config */}
        <Box flexDirection="row">{leftModules.includes('character') && renderCharacter()}</Box>

        {/* Right prompt (dimmed, shown below for simplicity) */}
        {rightModules.length > 0 && (
          <Box flexDirection="row" marginTop={1}>
            <Text color="gray" italic>
              right:{' '}
            </Text>
            {renderSide(rightModules, 'right')}
          </Box>
        )}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color="gray" italic>
          {leftSegmentCount} left segment{leftSegmentCount !== 1 ? 's' : ''}
          {rightModules.length > 0 ? `, ${rightModules.length} right` : ''}
        </Text>
      </Box>
    </Box>
  );
}
