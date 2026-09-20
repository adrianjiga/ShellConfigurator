import { cleanup, render } from 'ink-testing-library';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PromptPreview } from '../../components/PromptPreview.tsx';
import { PREVIEW_DEBOUNCE_MS } from '../../services/preview.ts';
import { DEFAULT_STATE, type WizardState } from '../../types.ts';

// The debounced renderer must stay a stub so the render itself is hermetic; the
// static fallback is what these tests assert against until they opt into the
// real-render path explicitly.
const staticPreview = vi.fn(
  async (): Promise<{ mode: 'static'; reason: 'starship-missing' }> => ({
    mode: 'static',
    reason: 'starship-missing',
  })
);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function frame(overrides: Partial<WizardState> = {}) {
  const state: WizardState = { ...DEFAULT_STATE, ...overrides };
  return render(<PromptPreview state={state} renderPreview={staticPreview} />).lastFrame() ?? '';
}

async function settleRenderer() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(PREVIEW_DEBOUNCE_MS);
  });
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

  it('keeps the static fallback when the renderer reports static', async () => {
    vi.useFakeTimers();
    const ui = render(<PromptPreview state={DEFAULT_STATE} renderPreview={staticPreview} />);
    await settleRenderer();
    expect(ui.lastFrame()).toContain('~/projects/myapp');
    ui.unmount();
  });

  it('matches the snapshot of the static fallback frame', () => {
    const out = frame({
      leftModules: ['directory', 'git_branch', 'character'],
      rightModules: ['cmd_duration'],
    });
    expect(out).toMatchSnapshot();
  });

  it('swaps in the real starship output when the renderer succeeds', async () => {
    vi.useFakeTimers();
    const ui = render(
      <PromptPreview
        state={DEFAULT_STATE}
        renderPreview={async () => ({ mode: 'real', text: '~/myapp on  main \n❯' })}
      />
    );
    // The static frame shows before the debounce fires.
    expect(ui.lastFrame()).toContain('~/projects/myapp');
    await settleRenderer();
    expect(ui.lastFrame()).toContain('~/myapp on  main');
    expect(ui.lastFrame()).not.toContain('right:');
    ui.unmount();
  });

  it('stays on the static fallback when the renderer rejects', async () => {
    vi.useFakeTimers();
    const ui = render(
      <PromptPreview
        state={DEFAULT_STATE}
        renderPreview={async () => {
          throw new Error('starship exploded');
        }}
      />
    );
    await settleRenderer();
    expect(ui.lastFrame()).toContain('~/projects/myapp');
    expect(ui.lastFrame()).not.toContain('starship exploded');
    ui.unmount();
  });

  it('re-renders only when prompt-relevant state changes', async () => {
    vi.useFakeTimers();
    const renderer = vi.fn(
      async (): Promise<{ mode: 'static'; reason: 'starship-missing' }> => ({
        mode: 'static',
        reason: 'starship-missing',
      })
    );
    const base = { ...DEFAULT_STATE };
    const ui = render(<PromptPreview state={base} renderPreview={renderer} />);
    await settleRenderer();
    expect(renderer).toHaveBeenCalledTimes(1);

    // Step navigation changes state identity but not the preview signature.
    ui.rerender(<PromptPreview state={{ ...base, step: 'style' }} renderPreview={renderer} />);
    await settleRenderer();
    expect(renderer).toHaveBeenCalledTimes(1);

    // Changing a preview-relevant field re-renders.
    ui.rerender(
      <PromptPreview
        state={{ ...base, step: 'style', palette: 'vivid' }}
        renderPreview={renderer}
      />
    );
    await settleRenderer();
    expect(renderer).toHaveBeenCalledTimes(2);

    ui.unmount();
  });
});
