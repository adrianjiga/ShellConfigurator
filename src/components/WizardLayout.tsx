import { Box, Text, useStdout } from 'ink';
import type React from 'react';
import { STEP_ORDER, type WizardState, type WizardStep } from '../types.ts';
import { PromptPreview } from './PromptPreview.tsx';

const STEP_LABELS: Record<WizardStep, string> = {
  welcome: 'Welcome',
  fontcheck: 'Font',
  font_select: 'Font Pick',
  preset: 'Preset',
  segments_left: 'Left',
  segments_right: 'Right',
  style: 'Style',
  shells: 'Shell',
  review: 'Review',
  installing: 'Installing',
  done: 'Done',
};

interface WizardLayoutProps {
  state: WizardState;
  children: React.ReactNode;
  hidePreview?: boolean;
}

// Below this width the preview wraps into an unreadable block, so it is dropped.
const PREVIEW_MIN_COLUMNS = 100;

export function WizardLayout({ state, children, hidePreview }: WizardLayoutProps) {
  const { stdout } = useStdout();
  const currentIndex = Math.max(0, STEP_ORDER.indexOf(state.step));
  const showPreview =
    !hidePreview && (stdout?.columns ?? PREVIEW_MIN_COLUMNS) >= PREVIEW_MIN_COLUMNS;

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1} flexDirection="row" gap={1}>
        <Text bold color="cyan">
          ShellConfigurator
        </Text>
        <Text color="gray">—</Text>
        <Text color="gray">Starship prompt wizard</Text>
      </Box>

      {/* Progress bar */}
      <Box marginBottom={1} flexDirection="row" gap={1}>
        {STEP_ORDER.map((step, i) => {
          const isActive = i === currentIndex;
          const isDone = i < currentIndex;
          return (
            <Text key={step} color={isActive ? 'cyan' : isDone ? 'green' : 'gray'} bold={isActive}>
              {isDone ? '●' : isActive ? '◉' : '○'}
            </Text>
          );
        })}
        <Text color="gray">{` ${currentIndex + 1}. ${STEP_LABELS[state.step]}`}</Text>
      </Box>

      {/* Main content */}
      <Box flexDirection="row" gap={2}>
        {/* Left: wizard content */}
        <Box flexDirection="column" flexGrow={1} minWidth={40}>
          {children}
          {!hidePreview && !showPreview && (
            <Box marginTop={1}>
              <Text color="gray" italic>
                Preview hidden — widen the terminal to see it live.
              </Text>
            </Box>
          )}
        </Box>

        {/* Right: live preview (hidden on narrow terminals and on welcome/done) */}
        {showPreview && (
          <Box flexDirection="column" minWidth={36}>
            <PromptPreview state={state} />
          </Box>
        )}
      </Box>
    </Box>
  );
}
