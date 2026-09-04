import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { EventEmitter } from 'node:events';
import { render, Text } from 'ink';
import { WizardLayout } from '../../components/WizardLayout.tsx';
import { DEFAULT_STATE } from '../../types.ts';

// ink-testing-library pins its fake stdout to 100 columns, so to exercise the
// preview width threshold this test renders WizardLayout with its own stream.
class FakeStdout extends EventEmitter {
  columns: number;
  frames: string[] = [];
  constructor(columns: number) {
    super();
    this.columns = columns;
  }
  write(data: string) {
    this.frames.push(data);
  }
  get lastFrame() {
    return this.frames[this.frames.length - 1] ?? '';
  }
}

class FakeStderr extends EventEmitter {
  write() {
    // Ignore error output; nothing is expected on it here.
  }
}

const instances: Array<{ unmount: () => void; cleanup: () => void }> = [];
afterEach(() => {
  for (const instance of instances.splice(0)) {
    instance.unmount();
    instance.cleanup();
  }
});

function frame(width: number): string {
  const stdout = new FakeStdout(width);
  const instance = render(
    <WizardLayout state={DEFAULT_STATE}>
      <Text>step body</Text>
    </WizardLayout>,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: new FakeStderr() as unknown as NodeJS.WriteStream,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    }
  );
  instances.push(instance);
  return stdout.lastFrame;
}

describe('WizardLayout responsive preview', () => {
  it('renders the preview pane on a wide terminal', () => {
    expect(frame(120)).toContain('Preview');
    expect(frame(120)).not.toContain('Preview hidden');
  });

  it('hides the preview on a narrow terminal and shows a hint instead', () => {
    const narrow = frame(80);
    // No simulated prompt content from the Preview pane...
    expect(narrow).not.toContain('❯');
    // ...just the hint explaining why.
    expect(narrow).toContain('Preview hidden');
  });

  it('keeps the wizard content visible at narrow widths', () => {
    expect(frame(80)).toContain('step body');
  });
});
