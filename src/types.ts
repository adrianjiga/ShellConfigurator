export type ShellId = 'zsh' | 'bash' | 'fish' | 'nushell' | 'powershell';
export type CharacterSymbol = 'arrow' | 'lambda' | 'dollar';
export type ColorScheme = 'default' | 'pastel' | 'minimal';

export type WizardStep =
  | 'welcome'
  | 'fontcheck'
  | 'preset'
  | 'segments_left'
  | 'segments_right'
  | 'style'
  | 'shells'
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
};
