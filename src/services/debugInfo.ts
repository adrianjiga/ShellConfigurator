import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SHELLS } from '../config/shells.ts';
import { getShellConfigPath, hasManagedRcBlock, startsStarship } from '../generators/shellRc.ts';
import type { PackageManager, ShellId, TerminalId } from '../types.ts';
import { cachedStarshipVersion } from './cache.ts';
import {
  detectContainerAsync,
  detectCurrentShellAsync,
  detectInstalledShellsAsync,
  detectPackageManagerAsync,
  detectTerminalAsync,
  findStarshipAsync,
} from './detector.ts';
import { type DoctorReport, formatDoctorReport, runDoctor } from './doctor.ts';
import { commandPath } from './exec.ts';
import { type HistoryRecord, readHistory } from './history.ts';
import { redactHome, redactUrls } from './redact.ts';

export interface DebugShell {
  id: ShellId;
  label: string;
  installed: boolean;
  rcFile: string | null;
  startsStarship: boolean;
  managedBlock: boolean;
  config: boolean;
}

export interface DebugInfo {
  version: string;
  node: string;
  os: string;
  distro: string | null;
  packageManager: PackageManager;
  container: boolean;
  terminal: TerminalId | null;
  termProgram: string | null;
  term: string | null;
  locale: { LC_ALL: string | null; LC_CTYPE: string | null; LANG: string | null };
  currentShell: ShellId | null;
  starship: {
    installed: boolean;
    path: string | null;
    version: string | null;
    offPathDir: string | null;
    recordedVersion: string | null;
    configEnv: string | null;
  };
  shells: DebugShell[];
  path: { dir: string; hasStarship: boolean }[];
  lastRun: { kind: string; timestamp: string; exitCode?: number; command?: string } | null;
  doctor: DoctorReport;
}

export interface DebugInfoDeps {
  detectPackageManager: () => Promise<PackageManager>;
  detectInstalledShells: () => Promise<ShellId[]>;
  detectTerminal: () => Promise<TerminalId | null>;
  detectContainer: () => Promise<boolean>;
  detectCurrentShell: () => Promise<ShellId | null>;
  findStarship: () => Promise<{ installed: boolean; version?: string; pathDir?: string }>;
  starshipPath: () => string | null;
  recordedStarshipVersion: () => string | null;
  distro: () => string | null;
  runDoctor: () => Promise<DoctorReport>;
  history: () => HistoryRecord[];
  shellFacts: (shellId: ShellId) => Pick<DebugShell, 'startsStarship' | 'managedBlock' | 'config'>;
  hasStarshipIn: (dir: string) => boolean;
  env: NodeJS.ProcessEnv;
  os: () => string;
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function osReleasePrettyName(): string | null {
  for (const file of ['/etc/os-release', '/usr/lib/os-release']) {
    const match = /^PRETTY_NAME=(.*)$/m.exec(readText(file) ?? '');
    if (match) return match[1]!.trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return null;
}

export const DEFAULT_DEBUG_INFO_DEPS: DebugInfoDeps = {
  detectPackageManager: detectPackageManagerAsync,
  detectInstalledShells: detectInstalledShellsAsync,
  detectTerminal: detectTerminalAsync,
  detectContainer: detectContainerAsync,
  detectCurrentShell: detectCurrentShellAsync,
  findStarship: findStarshipAsync,
  starshipPath: () => commandPath('starship'),
  recordedStarshipVersion: () => {
    try {
      return cachedStarshipVersion();
    } catch {
      return null;
    }
  },
  distro: osReleasePrettyName,
  runDoctor: () => runDoctor(null),
  history: readHistory,
  shellFacts: (shellId) => ({
    startsStarship: startsStarship(shellId, false),
    managedBlock: hasManagedRcBlock(shellId),
    config: fs.existsSync(getShellConfigPath(shellId)),
  }),
  hasStarshipIn: (dir) => fs.existsSync(path.join(dir, 'starship')),
  env: process.env,
  os: () => `${os.type()} ${os.release()} (${process.platform}/${process.arch})`,
};

/** Everything a bug report needs about this machine's setup. Reads only. */
export async function collectDebugInfo(
  version: string,
  deps: DebugInfoDeps = DEFAULT_DEBUG_INFO_DEPS
): Promise<DebugInfo> {
  const [packageManager, installed, terminal, container, currentShell, starship, doctor] =
    await Promise.all([
      deps.detectPackageManager(),
      deps.detectInstalledShells(),
      deps.detectTerminal(),
      deps.detectContainer(),
      deps.detectCurrentShell(),
      deps.findStarship(),
      deps.runDoctor(),
    ]);
  const env = deps.env;
  const last = deps.history().at(-1);
  return {
    version,
    node: process.version,
    os: deps.os(),
    distro: deps.distro(),
    packageManager,
    container,
    terminal,
    termProgram: env.TERM_PROGRAM ?? null,
    term: env.TERM ?? null,
    locale: { LC_ALL: env.LC_ALL ?? null, LC_CTYPE: env.LC_CTYPE ?? null, LANG: env.LANG ?? null },
    currentShell,
    starship: {
      installed: starship.installed,
      path: deps.starshipPath(),
      version: starship.version ?? null,
      offPathDir: starship.pathDir ?? null,
      recordedVersion: deps.recordedStarshipVersion(),
      configEnv: env.STARSHIP_CONFIG ?? null,
    },
    shells: SHELLS.map((shell) => ({
      id: shell.id,
      label: shell.label,
      installed: installed.includes(shell.id),
      rcFile: shell.rcFile ?? shell.initPath ?? null,
      ...deps.shellFacts(shell.id),
    })),
    path: (env.PATH ?? '')
      .split(path.delimiter)
      .filter(Boolean)
      .map((dir) => ({ dir, hasStarship: deps.hasStarshipIn(dir) })),
    lastRun: last
      ? {
          kind: last.kind,
          timestamp: last.timestamp,
          ...(last.exitCode !== undefined ? { exitCode: last.exitCode } : {}),
          ...(last.command ? { command: redactUrls(last.command) } : {}),
        }
      : null,
    doctor,
  };
}

const yesNo = (value: boolean) => (value ? 'yes' : 'no');
const orNone = (value: string | null | undefined) => (value ? `\`${value}\`` : '(none)');

/** The Markdown report `debug-info` prints, ready to paste into an issue. */
export function formatDebugInfo(info: DebugInfo): string {
  const s = info.starship;
  const lines = [
    '# shell-configurator debug info',
    '',
    `- shell-configurator: ${info.version}`,
    `- Node: ${info.node}`,
    `- OS: ${info.os}${info.distro ? ` — ${info.distro}` : ''}`,
    `- Package manager: ${info.packageManager}`,
    `- Container: ${yesNo(info.container)}`,
    `- Terminal: ${info.terminal ?? 'not recognised'} (TERM_PROGRAM ${orNone(info.termProgram)}, TERM ${orNone(info.term)})`,
    `- Locale: LC_ALL ${orNone(info.locale.LC_ALL)}, LC_CTYPE ${orNone(info.locale.LC_CTYPE)}, LANG ${orNone(info.locale.LANG)}`,
    `- Current shell: ${info.currentShell ?? 'not recognised'}`,
    '',
    '## Starship',
    '',
    `- Installed: ${yesNo(s.installed)}${s.path ? ` at \`${s.path}\`` : ''}${s.offPathDir ? ` (in \`${s.offPathDir}\`, not on PATH)` : ''}`,
    `- Version: ${s.version ?? '(unknown)'}`,
    `- Version recorded at install: ${s.recordedVersion ?? '(none)'}`,
    `- STARSHIP_CONFIG: ${orNone(s.configEnv)}`,
    '',
    '## Shells',
    '',
    '| Shell | Installed | Config file | Starts Starship | ShellConfigurator block | Per-shell config |',
    '| ----- | --------- | ----------- | --------------- | ----------------------- | ---------------- |',
    ...info.shells.map(
      (shell) =>
        `| ${shell.label} | ${yesNo(shell.installed)} | ${orNone(shell.rcFile)} | ${yesNo(shell.startsStarship)} | ${yesNo(shell.managedBlock)} | ${yesNo(shell.config)} |`
    ),
    '',
    '## PATH',
    '',
    ...info.path.map(
      (entry) => `- \`${entry.dir}\`${entry.hasStarship ? ' — has `starship`' : ''}`
    ),
    '',
    '## Last recorded run',
    '',
    info.lastRun
      ? `${info.lastRun.kind} at ${info.lastRun.timestamp}${info.lastRun.exitCode !== undefined ? `, exit ${info.lastRun.exitCode}` : ''}${info.lastRun.command ? ` (\`${info.lastRun.command}\`)` : ''}`
      : '(none)',
    '',
    '## Doctor',
    '',
    '```text',
    formatDoctorReport(info.doctor).trimEnd(),
    '```',
  ];
  return redactHome(`${lines.join('\n')}\n`);
}
