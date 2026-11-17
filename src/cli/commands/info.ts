import type { CliFlags } from '../../services/args.ts';
import {
  COMPLETION_SHELLS,
  type CompletionShell,
  LIST_KINDS,
  type ListKind,
} from '../../services/cliSurface.ts';
import { completionScript } from '../../services/completions.ts';
import {
  collectDebugInfo,
  DEFAULT_DEBUG_INFO_DEPS,
  type DebugInfoDeps,
  formatDebugInfo,
} from '../../services/debugInfo.ts';
import { CliUsageError } from '../../services/errors.ts';
import { formatListing, listEntries } from '../../services/listings.ts';
import { redactPersonal } from '../../services/redact.ts';
import { VERSION } from '../version.ts';

export function runListCommand(flags: CliFlags): void {
  const kind = flags.argument;
  if (!LIST_KINDS.includes(kind as ListKind)) {
    throw new CliUsageError(
      kind
        ? `Cannot list '${kind}' (available: ${LIST_KINDS.join(', ')}).`
        : `list needs what to list: ${LIST_KINDS.join(', ')}.`
    );
  }
  const entries = listEntries(kind as ListKind);
  process.stdout.write(
    flags.json ? `${JSON.stringify(entries, null, 2)}\n` : formatListing(entries)
  );
}

export function runCompletionsCommand(flags: CliFlags): void {
  const shell = flags.argument;
  if (!COMPLETION_SHELLS.includes(shell as CompletionShell)) {
    throw new CliUsageError(
      shell
        ? `No completions for '${shell}' (available: ${COMPLETION_SHELLS.join(', ')}).`
        : `completions needs a shell: ${COMPLETION_SHELLS.join(', ')}.`
    );
  }
  process.stdout.write(completionScript(shell as CompletionShell));
}

/** Prints the debug report (Markdown, or JSON with --json) with the home directory shown as `~`. */
export async function runDebugInfoCommand(
  flags: CliFlags,
  deps: DebugInfoDeps = DEFAULT_DEBUG_INFO_DEPS
): Promise<void> {
  const info = await collectDebugInfo(VERSION, deps);
  process.stdout.write(
    flags.json ? redactPersonal(`${JSON.stringify(info, null, 2)}\n`) : formatDebugInfo(info)
  );
}
