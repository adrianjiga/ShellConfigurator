import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockQuestion, mockClose } = vi.hoisted(() => ({
  mockQuestion: vi.fn(),
  mockClose: vi.fn(),
}));

vi.mock('node:readline/promises', () => ({
  createInterface: () => ({ question: mockQuestion, close: mockClose }),
}));

import { DEFAULT_PROMPT_IO } from '../../cli/prompt.ts';

describe('DEFAULT_PROMPT_IO', () => {
  const tty = { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY };
  afterEach(() => {
    vi.clearAllMocks();
    process.stdin.isTTY = tty.stdin;
    process.stdout.isTTY = tty.stdout;
  });

  it.each([
    ['y', true],
    [' YES ', true],
    ['n', false],
    ['', false],
    ['yeah', false],
  ])('reads the answer %o as %s, and always closes the prompt', async (answer, yes) => {
    mockQuestion.mockResolvedValueOnce(answer);

    await expect(DEFAULT_PROMPT_IO.confirm('Go? ')).resolves.toBe(yes);
    expect(mockQuestion).toHaveBeenCalledWith('Go? ');
    expect(mockClose).toHaveBeenCalledOnce();
  });

  it('closes the prompt when reading the answer fails', async () => {
    mockQuestion.mockRejectedValueOnce(new Error('closed'));

    await expect(DEFAULT_PROMPT_IO.confirm('Go? ')).rejects.toThrow('closed');
    expect(mockClose).toHaveBeenCalledOnce();
  });

  it('is a terminal only when both input and output are', () => {
    process.stdin.isTTY = true;
    process.stdout.isTTY = true;
    expect(DEFAULT_PROMPT_IO.isTerminal()).toBe(true);
    process.stdout.isTTY = false;
    expect(DEFAULT_PROMPT_IO.isTerminal()).toBe(false);
  });
});
