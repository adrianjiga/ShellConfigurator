import { describe, expect, it, vi } from 'vitest';
import { renderPromptAsync } from '../../services/preview.ts';
import { captureRun } from '../../services/runCapture.ts';
import { writeWhatChangedSafely } from '../../services/whatChanged.ts';

describe('test setup', () => {
  it('keeps screens from running the real starship preview', async () => {
    expect(vi.isMockFunction(renderPromptAsync)).toBe(true);
    await expect(renderPromptAsync({} as never)).resolves.toEqual({
      mode: 'static',
      reason: 'starship-missing',
    });
  });

  it('keeps runs from copying the real rc and config files', async () => {
    expect(vi.isMockFunction(captureRun)).toBe(true);
    await expect(captureRun(['/etc/passwd'], async () => 'ran')).resolves.toEqual({
      result: 'ran',
      runId: null,
    });
  });

  it('keeps runs from writing WHAT-CHANGED.md into the real home', () => {
    expect(vi.isMockFunction(writeWhatChangedSafely)).toBe(true);
    expect(writeWhatChangedSafely({} as never)).toBeNull();
  });
});
