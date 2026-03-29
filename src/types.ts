export type ShellId = 'zsh' | 'bash' | 'fish' | 'nushell' | 'powershell';
export type CharacterSymbol = 'arrow' | 'lambda' | 'dollar';
export type ColorScheme = 'default' | 'pastel' | 'minimal';
export type PackageManager = 'pacman' | 'apt' | 'dnf' | 'brew' | 'curl';
export type InstallStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface InstallTask {
  id: string;
  label: string;
  status: InstallStatus;
  error?: string;
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

export interface WizardState {
  step: WizardStep;
  starshipInstalled: boolean;
  hasNerdFont: boolean;
  preset: string | null;
  leftModules: string[];
  rightModules: string[];
  characterSymbol: CharacterSymbol;
  colorScheme: ColorScheme;
  selectedShells: ShellId[];
  packageManager: PackageManager;
  installedShells: ShellId[];
  nerdFontToInstall: string | null;
  setDefaultShell: ShellId | null;
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
  packageManager: 'curl',
  installedShells: [],
  nerdFontToInstall: null,
  setDefaultShell: null,
};
