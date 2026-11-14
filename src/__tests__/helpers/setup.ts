import { vi } from 'vitest';

vi.mock('../../services/preview.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/preview.ts')>()),
  renderPromptAsync: vi.fn(async () => ({ mode: 'static', reason: 'starship-missing' })),
}));

vi.mock('../../services/runCapture.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/runCapture.ts')>()),
  captureRun: vi.fn(async (_files: string[], run: () => Promise<unknown>) => ({
    result: await run(),
    runId: null,
  })),
}));

vi.mock('../../services/whatChanged.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/whatChanged.ts')>()),
  writeWhatChangedSafely: vi.fn(() => null),
}));
