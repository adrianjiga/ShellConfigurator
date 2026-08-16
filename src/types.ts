import type { ModuleId } from './config/modules.ts';

export type ShellId = 'zsh' | 'bash' | 'fish' | 'nushell' | 'powershell';
export type CharacterSymbol = 'arrow' | 'lambda' | 'dollar';
export type ColorScheme = 'default' | 'pastel' | 'minimal';
export type PackageManager = 'pacman' | 'apt' | 'dnf' | 'brew' | 'script';
export type InstallStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

/**
 * What the user decided about a Nerd Font. A discriminated union rather than a
 * nullable string with a sentinel, so "no font step", "route to the picker", and
 * "install this id" cannot be confused and no consumer needs to know a magic value.
 */
export type NerdFontChoice =
  | { kind: 'none' }
  | { kind: 'select' }
  | { kind: 'install'; id: string };

export const NO_NERD_FONT: NerdFontChoice = { kind: 'none' };

/** Whether the wizard should show the font selection step for this choice */
export function shouldVisitFontSelect(choice: NerdFontChoice): boolean {
  return choice.kind !== 'none';
}

/** The font id to install, or null when nothing should be installed. */
export function fontIdToInstall(choice: NerdFontChoice): string | null {
  return choice.kind === 'install' ? choice.id : null;
}

export interface InstallTask {
  id: string;
  label: string;
  status: InstallStatus;
  error?: string;
  /** Non-error detail about the outcome (e.g. "already configured", manual steps) */
  note?: string;
}

export type WizardStep =
  | 'welcome'
  | 'fontcheck'
  | 'font_select'
  | 'preset'
  | 'segments_left'
  | 'segments_right'
  | 'style'
  | 'shells'
  | 'installing'
  | 'done';

export const STEP_ORDER: WizardStep[] = [
  'welcome',
  'fontcheck',
  'font_select',
  'preset',
  'segments_left',
  'segments_right',
  'style',
  'shells',
  'installing',
  'done',
];

export interface WizardState {
  step: WizardStep;
  starshipInstalled: boolean;
  hasNerdFont: boolean;
  preset: string | null;
  leftModules: ModuleId[];
  rightModules: ModuleId[];
  characterSymbol: CharacterSymbol;
  colorScheme: ColorScheme;
  selectedShells: ShellId[];
  packageManager: PackageManager;
  installedShells: ShellId[];
  nerdFontToInstall: NerdFontChoice;
  setDefaultShell: ShellId | null;
  skipStarshipInstall: boolean;
  installResults: InstallTask[];
}

export const DEFAULT_STATE: WizardState = {
  step: 'welcome',
  starshipInstalled: false,
  hasNerdFont: false,
  preset: null,
  leftModules: ['directory', 'git_branch', 'git_status', 'character'],
  rightModules: [],
  characterSymbol: 'arrow',
  colorScheme: 'default',
  selectedShells: [],
  packageManager: 'script',
  installedShells: [],
  nerdFontToInstall: NO_NERD_FONT,
  setDefaultShell: null,
  skipStarshipInstall: false,
  installResults: [],
};
