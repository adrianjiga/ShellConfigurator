import React from 'react';
import { Box, Text } from 'ink';
import { WizardState, ColorScheme, CharacterSymbol } from '../types.js';
import { getModule } from '../config/modules.js';

const CHAR_SYMBOLS: Record<CharacterSymbol, { success: string; error: string }> = {
  arrow:  { success: '❯', error: '❯' },
  lambda: { success: 'λ', error: 'λ' },
  dollar: { success: '$', error: '$' },
};

const SCHEME_COLORS: Record<ColorScheme, { dir: string; branch: string; status: string; char: string }> = {
  default: { dir: 'blue',    branch: 'magenta', status: 'red',    char: 'green' },
  pastel:  { dir: 'cyan',    branch: 'magenta', status: 'yellow', char: 'green' },
  minimal: { dir: 'white',   branch: 'white',   status: 'red',    char: 'green' },
};

const MODULE_COLORS: Record<string, string> = {
  directory:      'blue',
  git_branch:     'magenta',
  git_status:     'red',
  nodejs:         'green',
  python:         'yellow',
  rust:           'red',
  docker_context: 'blue',
  kubernetes:     'cyan',
  aws:            'yellow',
  time:           'white',
  battery:        'yellow',
  cmd_duration:   'yellow',
  username:       'yellow',
  hostname:       'green',
  jobs:           'blue',
};

interface SegmentProps {
  text: string;
  color: string;
  bold?: boolean;
}

function Segment({ text, color, bold }: SegmentProps) {
  return <Text color={color} bold={bold}>{text} </Text>;
}

interface PromptPreviewProps {
  state: WizardState;
}

export function PromptPreview({ state }: PromptPreviewProps) {
  const { leftModules, rightModules, hasNerdFont, colorScheme, characterSymbol } = state;
  const colors = SCHEME_COLORS[colorScheme];

  function renderModule(id: string) {
    const def = getModule(id);
    if (!def) return null;

    if (id === 'character') {
      return (
        <Segment
          key="character"
          text={CHAR_SYMBOLS[characterSymbol].success}
          color={colors.char}
          bold
        />
      );
    }

    const color = id === 'directory'
      ? colors.dir
      : id === 'git_branch'
        ? colors.branch
        : id === 'git_status'
          ? colors.status
          : MODULE_COLORS[id] ?? 'white';

    return (
      <Segment
        key={id}
        text={def.previewSegment(hasNerdFont)}
        color={color}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold color="gray">Preview</Text>
      <Box
        borderStyle="round"
        borderColor="gray"
        padding={1}
        flexDirection="column"
        marginTop={1}
      >
        {/* Simulated previous command output */}
        <Text color="gray">$ some-command</Text>
        <Text color="gray">output line...</Text>
        <Box height={1} />

        {/* Left prompt */}
        <Box flexDirection="row" flexWrap="wrap">
          {leftModules.map((id) => renderModule(id))}
        </Box>

        {/* Right prompt (dimmed, shown below for simplicity) */}
        {rightModules.length > 0 && (
          <Box flexDirection="row" marginTop={1}>
            <Text color="gray" italic>right: </Text>
            {rightModules.map((id) => renderModule(id))}
          </Box>
        )}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color="gray" italic>
          {leftModules.filter(m => m !== 'character').length} left segment{leftModules.filter(m => m !== 'character').length !== 1 ? 's' : ''}
          {rightModules.length > 0 ? `, ${rightModules.length} right` : ''}
        </Text>
      </Box>
    </Box>
  );
}
