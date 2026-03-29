import React from 'react';
import { Box, Text } from 'ink';
import { WizardState, WizardStep } from '../types.js';
import { PromptPreview } from './PromptPreview.js';

const STEP_LABELS: Record<WizardStep, string> = {
  welcome:        '1. Welcome',
  fontcheck:      '2. Font Check',
  preset:         '3. Preset',
  segments_left:  '4. Left Prompt',
  segments_right: '5. Right Prompt',
  style:          '6. Style',
  shells:         '7. Shell',
  done:           '  Done',
};

const STEP_ORDER: WizardStep[] = [
  'welcome', 'fontcheck', 'preset', 'segments_left', 'segments_right', 'style', 'shells', 'done',
];

interface WizardLayoutProps {
  state: WizardState;
  children: React.ReactNode;
  hidePreview?: boolean;
}

export function WizardLayout({ state, children, hidePreview }: WizardLayoutProps) {
  const currentIndex = STEP_ORDER.indexOf(state.step);

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1} flexDirection="row" gap={1}>
        <Text bold color="cyan">ShellConfigurator</Text>
        <Text color="gray">—</Text>
        <Text color="gray">Starship prompt wizard</Text>
      </Box>

      {/* Progress bar */}
      <Box marginBottom={1} flexDirection="row" gap={1}>
        {STEP_ORDER.map((step, i) => {
          const isActive = i === currentIndex;
          const isDone = i < currentIndex;
          return (
            <Text
              key={step}
              color={isActive ? 'cyan' : isDone ? 'green' : 'gray'}
              bold={isActive}
            >
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
