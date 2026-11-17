import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hasStarshipInit } from '../../generators/rcLines.ts';

beforeEach(() => {
  vi.stubEnv('XDG_CONFIG_HOME', undefined);
  vi.stubEnv('ZDOTDIR', undefined);
  vi.stubEnv('STARSHIP_CONFIG', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('hasStarshipInit', () => {
  it('accepts every spelling of a shell init', () => {
    expect(hasStarshipInit('eval "$(starship init zsh)"', 'zsh')).toBe(true);
    expect(hasStarshipInit('source <(starship init zsh)', 'zsh')).toBe(true);
    expect(hasStarshipInit('eval "$(/opt/homebrew/bin/starship init zsh)"', 'zsh')).toBe(true);
    expect(hasStarshipInit('starship init fish | source', 'fish')).toBe(true);
  });

  it('ignores commented-out init lines', () => {
    expect(hasStarshipInit('# eval "$(starship init zsh)"', 'zsh')).toBe(false);
    expect(hasStarshipInit('  # starship init fish | source', 'fish')).toBe(false);
  });

  it('does not match another shell init', () => {
    expect(hasStarshipInit('eval "$(starship init bash)"', 'zsh')).toBe(false);
  });
});
