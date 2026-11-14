import { cleanup, render } from 'ink-testing-library';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PromptPreview, resetPreviewCacheForTests } from '../../components/PromptPreview.tsx';
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
  resetPreviewCacheForTests();
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
    const dollarLines = frame({ characterSymbol: 'dollar' }).split('\n');
    expect(dollarLines.some((line) => /^[│\s]*\$[│\s]*$/.test(line))).toBe(true);
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

  it('shows Nerd Font symbols in the static preview when enabled', () => {
    const out = frame({ hasNerdFont: true, leftModules: ['directory', 'git_branch', 'character'] });
    expect(out).toContain('');
    expect(out).toContain(' main');
  });

  it('reflects directory depth and substitutions in the static preview', () => {
    const truncated = frame({
      directoryTruncationLength: 1,
      leftModules: ['directory', 'character'],
    });
    // Starship's default truncation symbol is empty, so nothing marks the cut.
    expect(truncated).toContain('myapp');
    expect(truncated).not.toContain('…/');
    expect(truncated).not.toContain('projects');
    expect(
      frame({
        directoryTruncationLength: 0,
        directorySubstitutions: [{ from: 'projects', to: 'code' }],
        leftModules: ['directory', 'character'],
      })
    ).toContain('~/code/myapp');
    // Like starship, a substitution matches text anywhere in the path.
    expect(
      frame({
        directoryTruncationLength: 0,
        directorySubstitutions: [{ from: 'my', to: 'our' }],
        leftModules: ['directory', 'character'],
      })
    ).toContain('~/projects/ourapp');
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

  it('counts each module once, where the prompt places it', () => {
    const out = frame({
      leftModules: ['directory', 'directory', 'character'],
      rightModules: ['directory', 'nodejs', 'nodejs'],
    });
    expect(out).toContain('1 left segment, 1 right');
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

    ui.rerender(
      <PromptPreview
        state={{ ...base, step: 'style', palette: 'vivid', directoryTruncationLength: 1 }}
        renderPreview={renderer}
      />
    );
    await settleRenderer();
    expect(renderer).toHaveBeenCalledTimes(3);

    ui.rerender(
      <PromptPreview
        state={{
          ...base,
          step: 'style',
          palette: 'vivid',
          directoryTruncationLength: 1,
          directorySubstitutions: [{ from: 'projects', to: 'code' }],
        }}
        renderPreview={renderer}
      />
    );
    await settleRenderer();
    expect(renderer).toHaveBeenCalledTimes(4);

    ui.unmount();
  });
});

describe('bracketed preset', () => {
  it('draws each segment in brackets in the static frame', async () => {
    const { lastFrame } = render(
      <PromptPreview
        state={{
          ...DEFAULT_STATE,
          preset: 'bracketed-segments',
          leftModules: ['directory', 'git_branch', 'character'],
        }}
        renderPreview={async () => ({ mode: 'static', reason: 'starship-missing' })}
      />
    );

    expect(lastFrame()).toContain('[~/projects/myapp]');
    expect(lastFrame()).toContain('[main]');
  });
});

describe('PromptPreview signature', () => {
  it('re-renders for a preset change but not for the wrapped-line marker', async () => {
    vi.useFakeTimers();
    const renderer = vi.fn(async () => ({
      mode: 'static' as const,
      reason: 'starship-missing' as const,
    }));
    const base = { ...DEFAULT_STATE };
    const ui = render(<PromptPreview state={base} renderPreview={renderer} />);
    await settleRenderer();

    ui.rerender(
      <PromptPreview state={{ ...base, continuationPrompt: 'none' }} renderPreview={renderer} />
    );
    await settleRenderer();
    expect(renderer).toHaveBeenCalledTimes(1);

    ui.rerender(
      <PromptPreview
        state={{ ...base, continuationPrompt: 'none', preset: 'bracketed-segments' }}
        renderPreview={renderer}
      />
    );
    await settleRenderer();
    expect(renderer).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe('PromptPreview across screens', () => {
  it('starts a newly mounted preview from the last render instead of re-running starship', async () => {
    vi.useFakeTimers();
    const renderer = vi.fn(async () => ({ mode: 'real' as const, text: 'REAL PROMPT' }));
    const first = render(<PromptPreview state={DEFAULT_STATE} renderPreview={renderer} />);
    await settleRenderer();
    expect(first.lastFrame()).toContain('REAL PROMPT');
    first.unmount();

    const second = render(<PromptPreview state={DEFAULT_STATE} renderPreview={renderer} />);
    await settleRenderer();
    expect(second.lastFrame()).toContain('REAL PROMPT');
    expect(renderer).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('marks the shown prompt as updating while a new render is pending', async () => {
    vi.useFakeTimers();
    const renderer = vi.fn(async () => ({ mode: 'real' as const, text: 'REAL PROMPT' }));
    const ui = render(<PromptPreview state={DEFAULT_STATE} renderPreview={renderer} />);
    await settleRenderer();
    ui.rerender(
      <PromptPreview state={{ ...DEFAULT_STATE, palette: 'vivid' }} renderPreview={renderer} />
    );
    expect(ui.lastFrame()).toContain('updating…');
    vi.useRealTimers();
  });
});

describe('PromptPreview duplicates', () => {
  it('draws a module picked on both sides only once, on the left', () => {
    const { lastFrame } = render(
      <PromptPreview
        state={{ ...DEFAULT_STATE, leftModules: ['time', 'character'], rightModules: ['time'] }}
        renderPreview={async () => ({ mode: 'static', reason: 'starship-missing' })}
      />
    );
    expect(lastFrame()?.match(/12:34/g)).toHaveLength(1);
  });
});

describe('PromptPreview without colour', () => {
  it('draws powerline separators when colours and a Nerd Font are on', () => {
    vi.stubEnv('NO_COLOR', '');
    try {
      expect(frame({ hasNerdFont: true, powerline: true, preset: 'custom' })).toContain('\ue0b0');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('draws no blank line before the static prompt when add_newline is off', () => {
    const lines = frame({ addNewline: false }).split('\n');
    const output = lines.findIndex((line) => line.includes('output line...'));
    expect(lines[output + 1]).toContain('~/projects/myapp');
  });

  it('says the prompt was rendered live once the real render is current', async () => {
    vi.useFakeTimers();
    const ui = render(
      <PromptPreview
        state={DEFAULT_STATE}
        renderPreview={async () => ({ mode: 'real', text: '~/myapp\n❯' })}
      />
    );
    await settleRenderer();
    expect(ui.lastFrame()).toContain('rendered live by the starship binary');
    ui.unmount();
  });

  it('draws the plain layout instead of bare powerline arrows', () => {
    vi.stubEnv('NO_COLOR', '1');
    try {
      const { lastFrame } = render(
        <PromptPreview
          state={{ ...DEFAULT_STATE, hasNerdFont: true, powerline: true }}
          renderPreview={async () => ({ mode: 'static', reason: 'starship-missing' })}
        />
      );
      expect(lastFrame()).not.toContain('\ue0b0');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('PromptPreview width', () => {
  it('asks the renderer for a prompt as wide as the panel', async () => {
    vi.useFakeTimers();
    const renderer = vi.fn(async () => ({
      mode: 'static' as const,
      reason: 'starship-missing' as const,
    }));
    render(<PromptPreview state={DEFAULT_STATE} renderPreview={renderer} width={50} />);
    await settleRenderer();
    expect(renderer).toHaveBeenCalledWith(DEFAULT_STATE, 50);
    vi.useRealTimers();
  });
});

describe('PromptPreview blank line', () => {
  it('draws the blank line before a real prompt only when add_newline is on', async () => {
    vi.useFakeTimers();
    const renderer = vi.fn(async () => ({ mode: 'real' as const, text: 'REAL' }));
    const on = render(<PromptPreview state={DEFAULT_STATE} renderPreview={renderer} />);
    await settleRenderer();
    expect(on.lastFrame()).toMatch(/output line\.\.\.\s*│\n│\s*│\n│ REAL/);
    on.unmount();
    resetPreviewCacheForTests();

    const off = render(
      <PromptPreview state={{ ...DEFAULT_STATE, addNewline: false }} renderPreview={renderer} />
    );
    await settleRenderer();
    expect(off.lastFrame()).toMatch(/output line\.\.\.\s*│\n│ REAL/);
    vi.useRealTimers();
  });
});
