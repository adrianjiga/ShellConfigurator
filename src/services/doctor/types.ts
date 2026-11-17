import type { ShellId, TerminalId } from '../../types.ts';
import type {
  detectCurrentShellAsync,
  detectInstalledShellsAsync,
  detectTerminalAsync,
  isStarshipInstalledAsync,
} from '../detector.ts';
import type { readTerminalFontFamily } from '../terminalFont.ts';

export type DoctorStatus = 'pass' | 'warn' | 'fail';

/** A repair that `doctor --fix` knows how to apply. */
export type DoctorFix =
  | { kind: 'reinstall-starship' }
  | { kind: 'configure-shell'; shellId: ShellId }
  | { kind: 'write-config'; shellId: ShellId }
  | { kind: 'reinstall-font'; fontId: string }
  | { kind: 'wire-font'; terminalId: TerminalId; family: string };

export interface DoctorFinding {
  id: string;
  title: string;
  status: DoctorStatus;
  detail: string;
  fix?: DoctorFix;
}

export interface DoctorReport {
  ok: boolean;
  findings: DoctorFinding[];
}

export interface DoctorDeps {
  isStarshipInstalled: typeof isStarshipInstalledAsync;
  /** The script-install bin dir when starship is there but not on PATH, or null. */
  getMissingStarshipPathDir: () => string | null;
  /** Runs `starship -V` with the script install dir on PATH. */
  readStarshipVersion: (pathDir: string) => Promise<string | null>;
  detectCurrentShell: typeof detectCurrentShellAsync;
  /** The starship version the last install/apply recorded, or null. */
  readCachedStarshipVersion: () => string | null;
  detectInstalledShells: typeof detectInstalledShellsAsync;
  lastRunShells: () => ShellId[] | null;
  detectTerminal: typeof detectTerminalAsync;
  readFontFamily: typeof readTerminalFontFamily;
  /** Terminals that render Nerd Font symbols without one installed. */
  hasBundledNerdFonts: (terminalId: TerminalId) => Promise<boolean>;
  verifyConfig: (configPath: string) => Promise<void>;
  readFile: (path: string) => string;
  exists: (path: string) => boolean;
  hasNerdFonts: (fontId?: string | null) => boolean;
  isContainer: () => Promise<boolean>;
  env: NodeJS.ProcessEnv;
}

export interface StarshipProbe {
  installed: boolean;
  version?: string;
  /** Where a script install put the binary, when PATH does not have it yet. */
  pathDir?: string;
}

export interface ShellWiring {
  id: ShellId;
  pointAtShared: boolean;
}
