import { vi } from 'vitest';

vi.mock('../../services/preview.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/preview.ts')>()),
  renderPromptAsync: vi.fn(async () => ({ mode: 'static', reason: 'starship-missing' })),
}));
