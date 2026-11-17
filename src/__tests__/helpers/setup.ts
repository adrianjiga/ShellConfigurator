import { vi } from 'vitest';

vi.mock('../../services/preview.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/preview.ts')>()),
  renderPromptAsync: vi.fn(async () => ({ mode: 'static', reason: 'starship-missing' })),
}));

vi.mock('../../services/runCapture.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/runCapture.ts')>();
  return {
    ...actual,
    captureRun: vi.fn(async (_files: string[], run: () => Promise<unknown>) => {
      try {
        return { result: await run(), runId: null, uncaptured: false };
      } catch (err) {
        throw new actual.CapturedRunError(null, err);
      }
    }),
  };
});

vi.mock('../../services/whatChanged.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/whatChanged.ts')>()),
  writeWhatChangedSafely: vi.fn(() => null),
}));

vi.mock('../../services/starshipProbe.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/starshipProbe.ts')>()),
  explainPromptAsync: vi.fn(async () => ({ mode: 'unavailable', reason: 'starship-missing' })),
}));
