import React from 'react';
import { Box, Text } from 'ink';
import { WizardState, WizardStep } from '../types.js';
import { PromptPreview } from './PromptPreview.js';

const STEP_LABELS: Record<WizardStep, string> = {
  welcome: '1. Welcome',
  fontcheck: '2. Font',
  font_select: '3. Font Pick',
  preset: '4. Preset',
  segments_left: '5. Left',
  segments_right: '6. Right',
  style: '7. Style',
  shells: '8. Shell',
  installing: '9. Installing',
  done: '  Done',
};

const STEP_ORDER: WizardStep[] = [
  'welcome',
  'fontcheck',
  'font_select',
  'preset',
  'segments_left',
  'segments_right',
  'style',
  'shells',
  'installing',
  'done',
];

interface WizardLayoutProps {
  state: WizardState;
  children: React.ReactNode;
  hidePreview?: boolean;
}

export function WizardLayout({ state, children, hidePreview }: WizardLayoutProps) {
  const currentIndex = Math.max(0, STEP_ORDER.indexOf(state.step));

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
        <Text color="gray"> {STEP_LABELS[state.step]}</Text>
      </Box>

      {/* Main content */}
      <Box flexDirection="row" gap={2}>
        {/* Left: wizard content */}
        <Box flexDirection="column" flexGrow={1} minWidth={40}>
          {children}
        </Box>

        {/* Right: live preview (hidden on welcome/done) */}
        {!hidePreview && (
          <Box flexDirection="column" minWidth={36}>
            <PromptPreview state={state} />
          </Box>
        )}
      </Box>
    </Box>
  );
}
