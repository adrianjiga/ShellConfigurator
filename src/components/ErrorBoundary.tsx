import React from 'react';
import { Box, Text } from 'ink';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  onError?: (error: Error) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Renders a readable message instead of dumping a React stack trace over a
 * half-drawn TUI. Ink has no built-in boundary, and a throw inside a screen
 * would otherwise tear down the render mid-frame.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <Box flexDirection="column" padding={1} gap={1}>
        <Text bold color="red">
          ShellConfigurator hit an unexpected error
        </Text>
        <Text color="red">{error.message}</Text>
        <Text color="gray">
          Nothing further was changed. Please re-run the wizard; if it keeps failing, report this
          with the message above.
        </Text>
      </Box>
    );
  }
}
