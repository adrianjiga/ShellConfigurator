import { describe, expect, it, vi } from 'vitest';
import { renderPromptAsync } from '../../services/preview.ts';

describe('test setup', () => {
  it('keeps screens from running the real starship preview', async () => {
    expect(vi.isMockFunction(renderPromptAsync)).toBe(true);
    await expect(renderPromptAsync({} as never)).resolves.toEqual({
      mode: 'static',
      reason: 'starship-missing',
    });
  });
});
