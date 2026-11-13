import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';
import { colorsEnabled, uiColor } from '../config/colors.ts';
import { getModule, isConfigurableModule, type ModuleId } from '../config/modules.ts';
import { getPalette, inkColor, type PaletteColorName } from '../config/palettes.ts';
import { bracketsSegments, rendersGlyphs } from '../config/presets.ts';
import {
  CHARACTER_SYMBOLS,
  NERD_FONT_SYMBOLS,
  SEPARATOR_LEFT,
  SEPARATOR_RIGHT,
} from '../config/promptSymbols.ts';
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
    // The preset decides bracketed and text-only output.
    state.preset,
    state.palette,
    state.powerline,
    state.characterSymbol,
    state.addNewline,
    state.vimMode,
    state.directoryTruncationLength,
    state.directorySubstitutions,
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
/**
 * The last finished render. Every screen mounts its own preview, so without this
 * each step change would flash the static frame and run starship again.
 */
let lastRender: { signature: string; text: string | null } | null = null;

/** Test-only: forget the last render so tests stay independent. */
export function resetPreviewCacheForTests(): void {
  if (process.env.VITEST === 'true') lastRender = null;
}

export function PromptPreview({ state, renderPreview = renderPromptAsync }: PromptPreviewProps) {
  const [realPrompt, setRealPrompt] = useState<string | null>(() => lastRender?.text ?? null);
  const [renderedSignature, setRenderedSignature] = useState<string | null>(
    () => lastRender?.signature ?? null
  );
  const signature = previewSignature(state);

  useEffect(() => {
    if (renderedSignature === signature) return;
    let cancelled = false;
    const finish = (text: string | null) => {
      if (cancelled) return;
      lastRender = { signature, text };
      setRenderedSignature(signature);
      setRealPrompt(text);
    };
    const timer = setTimeout(() => {
      void renderPreview(state)
        .then((result) => finish(result.mode === 'real' ? result.text : null))
        .catch(() => finish(null));
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [signature, state, renderPreview, renderedSignature]);

  const leftSegmentCount = state.leftModules.filter(isConfigurableModule).length;

  return (
    <Box flexDirection="column">
      <Text bold color={uiColor('gray')}>
        Preview
      </Text>
      {realPrompt !== null ? (
        <RealPromptFrame text={realPrompt} />
      ) : (
        <StaticPromptFrame state={state} />
      )}
      <Box marginTop={1} flexDirection="column">
        <Text color={uiColor('gray')} italic>
          {leftSegmentCount} left segment{leftSegmentCount !== 1 ? 's' : ''}
          {state.rightModules.length > 0 ? `, ${state.rightModules.length} right` : ''}
        </Text>
        {realPrompt !== null && (
          <Text color={uiColor('gray')} italic>
            {renderedSignature === signature ? 'rendered live by the starship binary' : 'updating…'}
          </Text>
        )}
      </Box>
    </Box>
  );
}

function RealPromptFrame({ text }: { text: string }) {
  return (
    <Box
      borderStyle="round"
      borderColor={uiColor('gray')}
      padding={1}
      flexDirection="column"
      marginTop={1}
    >
      {/* Simulated previous command output, as in the static frame */}
      <Text color={uiColor('gray')}>$ some-command</Text>
      <Text color={uiColor('gray')}>output line...</Text>
      <Box height={1} />
      <Text wrap="wrap">{text}</Text>
    </Box>
  );
}

/**
 * A small local approximation of the sample path used by the static preview.
 * Like starship, substitutions replace matching text anywhere in the path, and
 * truncation keeps the last folders with no marker (the default symbol is empty).
 */
function previewDirectory(state: WizardState): string {
  let full = '~/projects/myapp';
  for (const { from, to } of state.directorySubstitutions) full = full.split(from).join(to);
  const parts = full.split('/').filter(Boolean);
  const length = state.directoryTruncationLength;
  const renderedPath =
    length === 0 || parts.length <= length ? parts.join('/') : parts.slice(-length).join('/');
  return `${state.hasNerdFont ? NERD_FONT_SYMBOLS.directory : ''}${renderedPath}`;
}

function StaticPromptFrame({ state: chosen }: { state: WizardState }) {
  const state = { ...chosen, hasNerdFont: rendersGlyphs(chosen) };
  const { leftModules, hasNerdFont, characterSymbol } = state;
  // As in the generator: a module on both sides renders once, on the left.
  const rightModules = state.rightModules.filter((id) => !leftModules.includes(id));
  const palette = getPalette(state.palette);
  // Mirrors the generator: separators are Nerd Font glyphs, so without one the
  // preview must show the plain prompt that will actually be written.
  // Without colour there are no blocks to interlock, only bare arrows.
  const powerline = state.powerline && hasNerdFont && colorsEnabled();
  const bracketed = bracketsSegments(state);

  const color = (name: PaletteColorName) => inkColor(palette.colors[name]);

  function renderCharacter() {
    return (
      <Text key="character" color={uiColor(color('ok'))} bold>
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
        const plain = bracketed ? text : (def.plainPreview?.(hasNerdFont) ?? text);
        const shown = id === 'directory' ? previewDirectory(state) : plain;
        return [
          <Text key={id} color={uiColor(color(def.id))}>
            {bracketed ? `[${shown}]` : shown}{' '}
          </Text>,
        ];
      }

      const neighbour = segments[side === 'left' ? i + 1 : i - 1];
      const neighbourColor = neighbour ? color(neighbour) : undefined;
      const block = (
        <Text
          key={`${id}-block`}
          color={uiColor(color('fg'))}
          backgroundColor={uiColor(color(def.id))}
          bold
        >
          {' '}
          {id === 'directory' ? previewDirectory(state) : text}{' '}
        </Text>
      );
      const separator = (
        <Text
          key={`${id}-sep`}
          color={uiColor(color(def.id))}
          backgroundColor={uiColor(neighbourColor)}
        >
          {side === 'left' ? SEPARATOR_RIGHT : SEPARATOR_LEFT}
        </Text>
      );

      return side === 'left' ? [block, separator] : [separator, block];
    });
  }

  return (
    <Box
      borderStyle="round"
      borderColor={uiColor('gray')}
      padding={1}
      flexDirection="column"
      marginTop={1}
    >
      {/* Simulated previous command output */}
      <Text color={uiColor('gray')}>$ some-command</Text>
      <Text color={uiColor('gray')}>output line...</Text>
      {state.addNewline && <Box height={1} />}

      {/* Left prompt */}
      <Box flexDirection="row" flexWrap="wrap">
        {renderSide(leftModules, 'left')}
      </Box>

      {/* The prompt character sits on its own line, as in the generated config */}
      <Box flexDirection="row">{renderCharacter()}</Box>

      {/* Right prompt (dimmed, shown below for simplicity) */}
      {rightModules.length > 0 && (
        <Box flexDirection="row" marginTop={1}>
          <Text color={uiColor('gray')} italic>
            right:{' '}
          </Text>
          {renderSide(rightModules, 'right')}
        </Box>
      )}
    </Box>
  );
}
