import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render, cleanup } from 'ink-testing-library';
import { Text } from 'ink';
import { ErrorBoundary } from '../../components/ErrorBoundary.tsx';

afterEach(cleanup);

function Boom(): React.ReactElement {
  throw new Error('screen exploded');
}

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    const out = render(
      <ErrorBoundary>
        <Text>all good</Text>
      </ErrorBoundary>
    ).lastFrame();

    expect(out).toContain('all good');
  });

  it('renders a readable message instead of a stack trace', () => {
    // React logs the caught error to stderr; silence it for the test output.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn();

    const out = render(
      <ErrorBoundary onError={onError}>
        <Boom />
      </ErrorBoundary>
    ).lastFrame();

    expect(out).toContain('unexpected error');
    expect(out).toContain('screen exploded');
    expect(out).not.toContain('at Boom');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'screen exploded' }));

    spy.mockRestore();
  });
});
