import { Box, Text } from 'ink';
import { useEffect, useRef, useState } from 'react';
import { getModule, isConfigurableModule, type ModuleId } from '../config/modules.ts';
import { getPalette, inkColor, type PaletteColorName } from '../config/palettes.ts';
import { CHARACTER_SYMBOLS, SEPARATOR_LEFT, SEPARATOR_RIGHT } from '../config/promptSymbols.ts';
import { PREVIEW_DEBOUNCE_MS, type PreviewResult, renderPromptAsync } from '../services/preview.ts';
import type { WizardState } from '../types.ts';

interface PromptPreviewProps {
  state: WizardState;
  /**
   * How the real prompt text is produced. Defaults to the starship service so
   * the wizard shows true output; tests inject a stub to stay hermetically
   * on the static fallback.
   */
  renderPreview?: (state: WizardState) => Promise<PreviewResult>;
}

/**
 * The fields that change what a rendered prompt looks like. Step navigation and
 * unrelated state (selected shells, package manager) must not re-render it.
 */
function previewSignature(state: WizardState): string {
  return JSON.stringify([
    state.keepExistingConfig,
    state.sharedConfigToml,
    state.palette,
    state.powerline,
    state.characterSymbol,
    state.hasNerdFont,
    state.leftModules,
    state.rightModules,
  ]);
}

/**
 * The live prompt panel. It asks the preview service for a real render of the
 * current config and paints that output; until one arrives (or when starship is
 * missing or the render fails) it draws the static approximation. Rendering is
 * debounced so a keyboard storm settles on exactly one starship invocation.
 */
export function PromptPreview({ state, renderPreview = renderPromptAsync }: PromptPreviewProps) {
  const [realPrompt, setRealPrompt] = useState<string | null>(null);
  const lastSignatureRef = useRef<string | null>(null);
  const signature = previewSignature(state);

  useEffect(() => {
    if (lastSignatureRef.current === signature) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void renderPreview(state)
        .then((result) => {
          if (cancelled) return;
          lastSignatureRef.current = signature;
          setRealPrompt(result.mode === 'real' ? result.text : null);
        })
        .catch(() => {
          if (cancelled) return;
          lastSignatureRef.current = signature;
          setRealPrompt(null);
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [signature, state, renderPreview]);

  const leftSegmentCount = state.leftModules.filter(isConfigurableModule).length;

  return (
    <Box flexDirection="column">
      <Text bold color="gray">
        Preview
      </Text>
      {realPrompt !== null ? (
        <RealPromptFrame text={realPrompt} />
      ) : (
        <StaticPromptFrame state={state} />
      )}
      <Box marginTop={1} flexDirection="column">
        <Text color="gray" italic>
          {leftSegmentCount} left segment{leftSegmentCount !== 1 ? 's' : ''}
          {state.rightModules.length > 0 ? `, ${state.rightModules.length} right` : ''}
        </Text>
        {realPrompt !== null && (
          <Text color="gray" italic>
            rendered live by the starship binary
          </Text>
        )}
      </Box>
    </Box>
  );
}

function RealPromptFrame({ text }: { text: string }) {
  return (
    <Box borderStyle="round" borderColor="gray" padding={1} flexDirection="column" marginTop={1}>
      {/* Simulated previous command output, as in the static frame */}
      <Text color="gray">$ some-command</Text>
      <Text color="gray">output line...</Text>
      <Box height={1} />
      <Text wrap="wrap">{text}</Text>
    </Box>
  );
}

function StaticPromptFrame({ state }: { state: WizardState }) {
  const { leftModules, rightModules, hasNerdFont, characterSymbol } = state;
  const palette = getPalette(state.palette);
  // Mirrors the generator: separators are Nerd Font glyphs, so without one the
  // preview must show the plain prompt that will actually be written.
  const powerline = state.powerline && hasNerdFont;

  const color = (name: PaletteColorName) => inkColor(palette.colors[name]);

  function renderCharacter() {
    return (
      <Text key="character" color={color('ok')} bold>
        {CHARACTER_SYMBOLS[characterSymbol].success}{' '}
      </Text>
    );
  }

  /**
   * Renders one side of the prompt. In powerline mode each segment is a coloured
   * block followed (or preceded) by a separator tinted with its neighbour's
   * colour, which is the same interlocking the generator writes into the config.
   */
  function renderSide(ids: ModuleId[], side: 'left' | 'right') {
    const segments = ids.filter(isConfigurableModule);

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

  return (
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
  );
}
