import * as fs from 'node:fs';
import { PRESETS } from '../config/presets.ts';
import { SHELLS } from '../config/shells.ts';
import { statusMark } from '../config/status.ts';
import { generateToml } from '../generators/starship.ts';
import {
  type CharacterSymbol,
  DEFAULT_STATE,
  type InstallTask,
  type ShellId,
  type WizardState,
} from '../types.ts';
import type { CliFlags } from './args.ts';
import { detectInstalledShellsAsync, detectPackageManagerAsync } from './detector.ts';
import { errorMessage } from './errors.ts';
import { appendHistory } from './history.ts';
import { buildTaskList, DEFAULT_INSTALL_TASK_DEPS, runInstallTasks } from './installTasks.ts';
import { parseState, serializeState } from './state.ts';

const SHELL_IDS = new Set<string>(SHELLS.map((s) => s.id));

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
  let state: WizardState;
  if (flags.stateFile) {
    state = parseState(fs.readFileSync(flags.stateFile, 'utf8'));
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
    }
  }

  if (flags.palette) state = { ...state, palette: flags.palette as WizardState['palette'] };
  if (flags.powerline !== undefined) state = { ...state, powerline: flags.powerline };
  if (flags.shells) {
    const shells = flags.shells.filter((id) => SHELL_IDS.has(id)) as ShellId[];
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

  return state;
}

/** The full `generate` subcommand: TOML (or a state card) from flags. */
export function runGenerate(flags: CliFlags): void {
  const state = stateFromFlags(flags);

  if (flags.exportFile) {
    fs.writeFileSync(flags.exportFile, serializeState(state));
    return;
  }

  const toml = generateToml(state);
  if (flags.outputFile) {
    fs.writeFileSync(flags.outputFile, toml);
  } else {
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

/**
 * Fills the runtime fields `apply` needs that `stateFromFlags` leaves defaulted:
 * which shells are installed, and which package manager installs should use.
 */
async function prepareApplyState(flags: CliFlags): Promise<WizardState> {
  const state = stateFromFlags(flags);
  const [installedShells, packageManager] = await Promise.all([
    detectInstalledShellsAsync(),
    detectPackageManagerAsync(),
  ]);
  return { ...state, installedShells, packageManager };
}

/**
 * The full `apply` subcommand: headless run of the same install pipeline the
 * wizard drives. `--dry-run` prints the task plan and the TOML that would be
 * written without touching the system; a real run records itself in history.
 */
export async function runApply(flags: CliFlags): Promise<void> {
  const state = await prepareApplyState(flags);
  const tasks = buildTaskList(state);

  if (flags.dryRun) {
    process.stdout.write('shell-configurator apply (dry run) — nothing will be changed.\n\n');
    process.stdout.write(
      `Targets: ${state.selectedShells.join(', ') || '(none)'} · ` +
        `will ${state.skipStarshipInstall ? 'skip' : 'install'} Starship\n`
    );
    printTasks(tasks);
    process.stdout.write('\nGenerated starship.toml:\n\n');
    process.stdout.write(generateToml(state));
    return;
  }

  const results = await runInstallTasks(state, DEFAULT_INSTALL_TASK_DEPS, () => {});
  const failed = results.some((t) => t.status === 'failed');
  printTasks(results);

  if (failed) process.exitCode = 1;

  // The ledger is best-effort: a run that just installed must not die because
  // the history file could not be written.
  try {
    appendHistory({
      version: 1,
      timestamp: new Date().toISOString(),
      kind: 'apply',
      results,
      exitCode: failed ? 1 : 0,
    });
  } catch (err) {
    process.stderr.write(`Warning: could not record this run in history: ${errorMessage(err)}\n`);
  }
}
