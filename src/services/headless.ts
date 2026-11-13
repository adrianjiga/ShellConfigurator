import * as fs from 'node:fs';
import * as path from 'node:path';
import { MODULES } from '../config/modules.ts';
import { PALETTES } from '../config/palettes.ts';
import { PRESETS } from '../config/presets.ts';
import { SHELLS } from '../config/shells.ts';
import { statusMark } from '../config/status.ts';
import { getSharedConfigPath, writeFileAtomic } from '../generators/shellRc.ts';
import { generateToml } from '../generators/starship.ts';
import {
  type CharacterSymbol,
  DEFAULT_STATE,
  type InstallTask,
  type ShellId,
  type WizardState,
} from '../types.ts';
import type { CliFlags } from './args.ts';
import {
  detectContainerAsync,
  detectInstalledShellsAsync,
  detectPackageManagerAsync,
  detectTerminalAsync,
} from './detector.ts';
import { CliRunError, CliUsageError, errorMessage } from './errors.ts';
import { recordRun } from './history.ts';
import { NERD_FONTS } from './installer.ts';
import { buildTaskList, DEFAULT_INSTALL_TASK_DEPS, runInstallTasks } from './installTasks.ts';
import { parseState, serializeState } from './state.ts';

const SHELL_IDS = new Set<string>(SHELLS.map((s) => s.id));
const MODULE_IDS = new Set<string>([...MODULES.map((m) => m.id), 'character']);
const PRESET_IDS = PRESETS.map((p) => p.id);
const PALETTE_IDS: string[] = PALETTES.map((p) => p.id);
const CHARACTER_SYMBOLS: readonly CharacterSymbol[] = ['arrow', 'lambda', 'dollar'];
const FONT_IDS = new Set<string>(NERD_FONTS.map((f) => f.id));

function unknown(what: string, value: string, valid: readonly string[]): CliUsageError {
  return new CliUsageError(`Unknown ${what}: '${value}' (expected one of: ${valid.join(', ')})`);
}

/**
 * Fail-fast validation of the public flag surface (D2). Every value that can
 * reach the generator must be one it understands: a typo'd `--preset`,
 * `--palette`, `--character`, `--set-default`, `--shells` or `--font` must
 * error before any install work, not crash deep in the generator with a
 * confusing TypeError or silently change the result.
 */
export function validateFlagValues(flags: CliFlags): void {
  if (flags.shells) {
    for (const shell of flags.shells) {
      if (!SHELL_IDS.has(shell)) throw unknown('shell id (--shells)', shell, [...SHELL_IDS]);
    }
  }
  if (flags.preset && !PRESET_IDS.includes(flags.preset)) {
    throw unknown('preset (--preset)', flags.preset, PRESET_IDS);
  }
  if (flags.palette && !PALETTE_IDS.includes(flags.palette)) {
    throw unknown('palette (--palette)', flags.palette, PALETTE_IDS);
  }
  if (
    flags.characterSymbol &&
    !CHARACTER_SYMBOLS.includes(flags.characterSymbol as CharacterSymbol)
  ) {
    throw unknown('character symbol (--character)', flags.characterSymbol, [...CHARACTER_SYMBOLS]);
  }
  if (flags.setDefaultShell && !SHELL_IDS.has(flags.setDefaultShell)) {
    throw unknown('shell id (--set-default)', flags.setDefaultShell, [...SHELL_IDS]);
  }
  if (flags.font && flags.font !== 'none' && !FONT_IDS.has(flags.font)) {
    throw unknown('Nerd Font (--font)', flags.font, ['none', ...FONT_IDS]);
  }
}

/**
 * Same fail-fast discipline for a merged state — mainly the values that come
 * from a state card rather than the flags, which the parser's lenient coercion
 * lets through. `stateFromFlags` re-checks so the card path cannot bypass it.
 * Module ids are checked here too (left/right), since a hand-edited card can
 * carry one the generator would otherwise render as a dead `[bogus]` stub.
 */
function assertValidState(state: WizardState): void {
  if (state.preset !== null && !PRESET_IDS.includes(state.preset)) {
    throw unknown('preset', state.preset, PRESET_IDS);
  }
  if (!PALETTE_IDS.includes(state.palette)) {
    throw unknown('palette', state.palette, PALETTE_IDS);
  }
  if (!CHARACTER_SYMBOLS.includes(state.characterSymbol)) {
    throw unknown('character symbol', state.characterSymbol, [...CHARACTER_SYMBOLS]);
  }
  for (const moduleId of [...state.leftModules, ...state.rightModules]) {
    if (!MODULE_IDS.has(moduleId)) throw unknown('module', moduleId, [...MODULE_IDS]);
  }
  if (state.setDefaultShell !== null && !SHELL_IDS.has(state.setDefaultShell)) {
    throw unknown('shell id (--set-default)', state.setDefaultShell, [...SHELL_IDS]);
  }
  for (const shell of state.selectedShells) {
    if (!SHELL_IDS.has(shell)) throw unknown('shell id', shell, [...SHELL_IDS]);
  }
  if (state.setDefaultShell !== null && !state.selectedShells.includes(state.setDefaultShell)) {
    throw new CliUsageError(
      `Cannot set '${state.setDefaultShell}' as the default shell: it is not one of the ` +
        `shells being configured (${state.selectedShells.join(', ') || 'none'}).`
    );
  }
  const font = state.nerdFontToInstall;
  if (font.kind === 'install' && !FONT_IDS.has(font.id)) {
    throw unknown('Nerd Font', font.id, [...FONT_IDS]);
  }
  if (font.kind === 'select') {
    throw new CliUsageError(
      'The state card defers the font choice to the interactive picker; pass --font <id> or --font none instead.'
    );
  }
}

/**
 * Builds a WizardState from CLI flags (and optionally a state card), reusing the
 * exact decisions the wizard makes:
 *
 * - a `--preset` seeds left/right modules, palette and powerline, exactly like
 *   choosing it on the Preset screen;
 * - every explicit flag then overrides the card/preset value;
 * - runtime fields (package manager, installed shells, step) stay at their
 *   defaults — `apply` fills those via detection before running.
 */
export function stateFromFlags(flags: CliFlags): WizardState {
  validateFlagValues(flags);
  let state: WizardState;
  if (flags.stateFile) {
    let json: string;
    try {
      json = fs.readFileSync(flags.stateFile, 'utf8');
    } catch (err) {
      throw new CliUsageError(
        `Could not read state card '${flags.stateFile}': ${errorMessage(err)}`
      );
    }
    state = parseState(json);
  } else {
    state = { ...DEFAULT_STATE };
  }

  if (flags.preset) {
    const preset = PRESETS.find((p) => p.id === flags.preset);
    if (preset) {
      state = {
        ...state,
        preset: preset.id,
        leftModules: preset.leftModules ?? state.leftModules,
        rightModules: preset.rightModules ?? state.rightModules,
        palette: preset.palette,
        powerline: preset.powerline,
      };
      // A preset that needs Nerd Font glyphs implies the machine renders them —
      // the wizard only offers those presets to users who already have a font.
      // An explicit --has-nerd-font / --no-nerd-font (or a later --font) still wins.
      if (flags.hasNerdFont === undefined && !flags.stateFile) {
        state = { ...state, hasNerdFont: preset.requiresNerdFont };
      }
      if (
        preset.requiresNerdFont &&
        flags.hasNerdFont === undefined &&
        flags.font === undefined &&
        !flags.stateFile
      ) {
        state = { ...state, nerdFontToInstall: { kind: 'install', id: NERD_FONTS[0].id } };
      }
    }
  }

  if (flags.palette) state = { ...state, palette: flags.palette as WizardState['palette'] };
  if (flags.powerline !== undefined) state = { ...state, powerline: flags.powerline };
  if (flags.shells) {
    const shells = [...new Set(flags.shells.filter((id) => SHELL_IDS.has(id)))] as ShellId[];
    state = { ...state, selectedShells: shells };
  }
  if (flags.characterSymbol) {
    state = { ...state, characterSymbol: flags.characterSymbol as CharacterSymbol };
  }
  if (flags.setDefaultShell) {
    state = { ...state, setDefaultShell: flags.setDefaultShell as ShellId };
  }
  if (flags.skipStarship) state = { ...state, skipStarshipInstall: true };
  if (flags.hasNerdFont !== undefined) state = { ...state, hasNerdFont: flags.hasNerdFont };
  if (flags.adopt) state = { ...state, keepExistingConfig: true };

  if (flags.font) {
    state = {
      ...state,
      nerdFontToInstall:
        flags.font === 'none' ? { kind: 'none' } : { kind: 'install', id: flags.font },
    };
    // Choosing a concrete font implies the machine will render its glyphs; an
    // explicit --has-nerd-font / --no-nerd-font still wins.
    if (flags.hasNerdFont === undefined) {
      state = { ...state, hasNerdFont: flags.font !== 'none' };
    }
  }

  assertValidState(state);
  if (state.powerline && !state.hasNerdFont) {
    process.stderr.write(
      'shell-configurator: warning: powerline separators need a Nerd Font; a plain prompt will be generated.\n'
    );
  }
  return state;
}

/** The full `generate` subcommand: TOML (or a state card) from flags. */
export function runGenerate(flags: CliFlags): void {
  if (flags.adopt || flags.importUrl) {
    throw new CliUsageError('--adopt and --import-url are only valid with the apply subcommand.');
  }
  const state = stateFromFlags(flags);
  if (state.keepExistingConfig) {
    throw new CliUsageError(
      'generate has nothing to write for an adopt-mode card; use apply, or drop keepExistingConfig.'
    );
  }
  const toml = generateToml(state);

  if (
    flags.outputFile &&
    flags.exportFile &&
    path.resolve(flags.outputFile) === path.resolve(flags.exportFile)
  ) {
    throw new CliUsageError(
      `Refusing to write the TOML and the state card to the same file: ${flags.outputFile}`
    );
  }

  if (flags.exportFile) {
    try {
      writeFileAtomic(flags.exportFile, serializeState(state));
    } catch (err) {
      throw new CliRunError(
        `Could not write state card to '${flags.exportFile}': ${errorMessage(err)}`
      );
    }
  }

  if (flags.outputFile) {
    try {
      writeFileAtomic(flags.outputFile, toml);
    } catch (err) {
      throw new CliRunError(`Could not write TOML to '${flags.outputFile}': ${errorMessage(err)}`);
    }
  } else if (!flags.exportFile) {
    process.stdout.write(toml);
  }
}

/** ONE-line status marks, padded for the plain-text headless summary. */
function statusWord(status: InstallTask['status'] | 'unknown'): string {
  const icon = statusMark(status).icon;
  return `${icon} ${status.toUpperCase().padEnd(7)}`;
}

function formatTask(t: InstallTask): string {
  const suffix = t.error ? ` — ${t.error}` : t.note ? ` (${t.note})` : '';
  return `${statusWord(t.status)} ${t.label}${suffix}`;
}

/** The plain-text plan/applied view `apply` prints to stdout. */
function printTasks(tasks: InstallTask[]): void {
  for (const task of tasks) process.stdout.write(`  ${formatTask(task)}\n`);
}

/** Cap on how long an --import-url fetch may hang before it is aborted. */
const IMPORT_FETCH_TIMEOUT_MS = 10_000;

/** Cap on how large an --import-url config may be. Starship configs are KBs. */
const IMPORT_FETCH_MAX_BYTES = 1_000_000;

export interface FetchConfigOptions {
  /** Abort the request after this many ms. Loose, for tests to shrink the wait. */
  timeoutMs?: number;
  /** Reject when the response exceeds this many bytes. */
  maxBytes?: number;
}

/**
 * Fetches a starship.toml from a gist/URL (`--import-url`) and folds it into
 * adopt mode: the downloaded content becomes the shared config every wired
 * shell reads, so the wizard never regenerates. Fails loud on a bad scheme,
 * an HTTP error, or an empty body. The fetch is bounded: a hung connection is
 * aborted after a timeout, and an oversized response (declared or actual) is
 * rejected so a broken or malicious URL cannot hold the run hostage or flood
 * memory.
 */
export async function fetchImportedConfig(
  url: string,
  options: FetchConfigOptions = {}
): Promise<string> {
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url)?.[1]?.toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') {
    throw new CliUsageError(`--import-url expects an http(s) URL, got '${url}'`);
  }
  if (scheme !== 'https') {
    throw new CliUsageError(
      `--import-url requires an https URL, got '${url}' — the downloaded config runs ` +
        'commands on every prompt, so it must not travel over plain http.'
    );
  }

  const timeoutMs = options.timeoutMs ?? IMPORT_FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? IMPORT_FETCH_MAX_BYTES;
  const shown = url.replace(/\/\/[^/@]*@/, '//');

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    // AbortSignal.timeout rejects with a TimeoutError DOMException on timeout.
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new CliRunError(`Could not fetch '${shown}': request timed out after ${timeoutMs}ms`);
    }
    throw new CliRunError(`Could not fetch '${shown}': ${errorMessage(err)}`);
  }
  if (!response.ok) {
    throw new CliRunError(`Could not fetch '${shown}': HTTP ${response.status}`);
  }
  if (response.url && !response.url.toLowerCase().startsWith('https://')) {
    throw new CliRunError(
      `Could not fetch '${shown}': redirected to a non-https URL ${response.url}`
    );
  }

  // A declared content-length is a cheap first gate; the actual byte count is
  // the real check, so a lying or chunked server cannot sneak past.
  const declaredSize = Number(response.headers.get('content-length') ?? '0');
  if (declaredSize > maxBytes) {
    throw new CliRunError(
      `Could not fetch '${shown}': server reports ${declaredSize} bytes, ` +
        `above the ${maxBytes} byte limit.`
    );
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body?.getReader();
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new CliRunError(`Could not fetch '${shown}': config exceeds ${maxBytes} bytes`);
        }
        chunks.push(value);
      }
    } catch (err) {
      if (err instanceof CliRunError) throw err;
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new CliRunError(`Could not fetch '${shown}': request timed out after ${timeoutMs}ms`);
      }
      throw new CliRunError(`Could not fetch '${shown}': ${errorMessage(err)}`);
    } finally {
      reader.releaseLock();
    }
  }

  const content = Buffer.concat(chunks).toString('utf8');
  if (content.trim().length === 0) {
    throw new CliRunError(`'${shown}' returned no config content`);
  }
  if (content.trimStart().startsWith('<')) {
    throw new CliRunError(`'${shown}' returned HTML, not a TOML config — use the raw file URL.`);
  }
  return content;
}

/**
 * Fills the runtime fields `apply` needs that `stateFromFlags` leaves defaulted:
 * which shells are installed, and which package manager installs should use.
 */
async function prepareApplyState(flags: CliFlags): Promise<WizardState> {
  let state = stateFromFlags(flags);

  if (!flags.dryRun && state.selectedShells.length === 0) {
    throw new CliUsageError(
      'apply configures at least one shell, but none are selected. ' +
        'Pass --shells <id,...> or a --state card that selects shells.'
    );
  }

  if (flags.importUrl) {
    state = {
      ...state,
      keepExistingConfig: true,
      sharedConfigToml: await fetchImportedConfig(flags.importUrl),
    };
  }
  const [installedShells, packageManager, container, terminal] = await Promise.all([
    detectInstalledShellsAsync(),
    detectPackageManagerAsync(),
    detectContainerAsync(),
    detectTerminalAsync(),
  ]);
  return { ...state, installedShells, packageManager, container, terminal };
}

/**
 * The full `apply` subcommand: headless run of the same install pipeline the
 * wizard drives. `--dry-run` prints the task plan and the TOML that would be
 * written without touching the system; a real run records itself in history.
 * `command` is the original invocation line stored for reproducibility.
 */
export async function runApply(flags: CliFlags, command?: string): Promise<void> {
  const state = await prepareApplyState(flags);

  const tasks = buildTaskList(state);

  if (flags.dryRun) {
    process.stdout.write('shell-configurator apply (dry run) — nothing will be changed.\n\n');
    process.stdout.write(
      `Targets: ${state.selectedShells.join(', ') || '(none)'} · ` +
        `will ${state.skipStarshipInstall ? 'skip' : 'install'} Starship\n`
    );
    printTasks(tasks);
    if (state.keepExistingConfig) {
      if (state.sharedConfigToml) {
        process.stdout.write('\nConfig to keep (no per-shell TOML is generated):\n\n');
        process.stdout.write(state.sharedConfigToml);
        if (!state.sharedConfigToml.endsWith('\n')) process.stdout.write('\n');
      } else {
        const shared = getSharedConfigPath();
        process.stdout.write(
          fs.existsSync(shared)
            ? `\nConfig to keep: ${shared} (left untouched)\n`
            : `\nNo config to keep yet: ${shared} does not exist, and a real run would leave that as is.\n`
        );
      }
    } else {
      process.stdout.write('\nGenerated starship.toml:\n\n');
      process.stdout.write(generateToml(state));
    }
    return;
  }

  const results = await runInstallTasks(state, DEFAULT_INSTALL_TASK_DEPS, () => {});
  const failed = results.some((t) => t.status === 'failed');
  printTasks(results);

  if (failed) process.exitCode = 1;

  // The ledger is best-effort: a run that just installed must not die because
  // the history file could not be written.
  try {
    recordRun({
      kind: 'apply',
      state,
      command,
      results,
      exitCode: failed ? 1 : 0,
    });
  } catch (err) {
    process.stderr.write(`Warning: could not record this run in history: ${errorMessage(err)}\n`);
  }
}
