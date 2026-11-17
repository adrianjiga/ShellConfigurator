import { createInterface } from 'node:readline/promises';
import type { CliFlags } from '../services/args.ts';
import { CliUsageError } from '../services/errors.ts';

async function askToProceed(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

export interface PromptIo {
  confirm: (question: string) => Promise<boolean>;
  isTerminal: () => boolean;
}

export const DEFAULT_PROMPT_IO: PromptIo = {
  confirm: askToProceed,
  isTerminal: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
};

/**
 * Whether a command that changes files may go ahead: --yes says so, a terminal
 * user is shown the plan and asked, and anything else is refused.
 */
export async function confirmChanges(
  flags: CliFlags,
  io: PromptIo,
  refusal: string,
  plan: () => string,
  question: string
): Promise<boolean> {
  if (flags.yes) return true;
  if (flags.json || !io.isTerminal()) {
    throw new CliUsageError(`${refusal}; pass --yes to go ahead, or --dry-run to see the plan.`);
  }
  process.stdout.write(plan());
  if (await io.confirm(question)) return true;
  process.stdout.write('Nothing was changed.\n');
  return false;
}
