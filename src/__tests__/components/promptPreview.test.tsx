import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from 'ink-testing-library';
import { PromptPreview } from '../../components/PromptPreview.tsx';
import { DEFAULT_STATE, WizardState } from '../../types.ts';

afterEach(cleanup);

function frame(overrides: Partial<WizardState> = {}) {
  const state: WizardState = { ...DEFAULT_STATE, ...overrides };
  return render(<PromptPreview state={state} />).lastFrame() ?? '';
}

describe('PromptPreview', () => {
  it('renders the prompt character for each symbol choice', () => {
    expect(frame({ characterSymbol: 'arrow' })).toContain('❯');
    expect(frame({ characterSymbol: 'lambda' })).toContain('λ');
    expect(frame({ characterSymbol: 'dollar' })).toContain('$ ');
  });

  it('renders the character even though it has no MODULES entry', () => {
    // 'character' is a ModuleId with no entry in MODULES; the preview must not
    // drop it on the module lookup.
    expect(frame({ leftModules: ['character'] })).toContain('❯');
  });

  it('renders the configured left modules', () => {
    const out = frame({ leftModules: ['directory', 'git_branch', 'character'] });
    expect(out).toContain('~/projects/myapp');
    expect(out).toContain('main');
    expect(out).toContain('❯');
  });

  it('renders right modules under a right: label', () => {
    const out = frame({ leftModules: ['character'], rightModules: ['cmd_duration'] });
    expect(out).toContain('right:');
    expect(out).toContain('2s');
  });

  it('excludes the character from the segment count', () => {
    expect(frame({ leftModules: ['directory', 'character'] })).toContain('1 left segment');
    expect(frame({ leftModules: ['directory', 'git_branch', 'character'] })).toContain(
      '2 left segments'
    );
  });

  it('ignores an unknown module id', () => {
    // Cast: the type forbids this, but state could still be malformed at runtime.
    const bogus = ['not_a_module', 'character'] as unknown as WizardState['leftModules'];
    expect(frame({ leftModules: bogus })).toContain('❯');
  });

  it('switches git branch glyphs with the nerd font flag', () => {
    expect(frame({ leftModules: ['git_branch'], hasNerdFont: false })).toContain('on main');
    expect(frame({ leftModules: ['git_branch'], hasNerdFont: true })).not.toContain('on main');
  });
});
