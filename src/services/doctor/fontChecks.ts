import { fontIdToInstall, type WizardState } from '../../types.ts';
import { fontLabel, getFontFamily, getNerdFontsDir } from '../installer.ts';
import { TERMINAL_LABELS } from '../terminalFont.ts';
import type { DoctorDeps, DoctorFinding, DoctorFix } from './types.ts';

export async function checkFontInstalled(
  state: WizardState | null,
  deps: DoctorDeps
): Promise<DoctorFinding> {
  const dir = getNerdFontsDir();
  const fontId = state ? fontIdToInstall(state.nerdFontToInstall) : null;
  if (await deps.isContainer()) {
    return {
      id: 'font-installed',
      title: 'Nerd Font',
      status: 'pass',
      detail: 'containers skip font installs',
    };
  }
  if (!fontId && state) {
    return {
      id: 'font-installed',
      title: 'Nerd Font',
      status: 'pass',
      detail: 'no Nerd Font requested',
    };
  }
  if (deps.hasNerdFonts(fontId)) {
    return {
      id: 'font-installed',
      title: 'Nerd Font',
      status: 'pass',
      detail: `Nerd Font files found for ${dir}`,
    };
  }
  return {
    id: 'font-installed',
    title: 'Nerd Font',
    // A font the state card asked for and that is missing is a broken setup;
    // without a card nothing says one was wanted.
    status: fontId ? 'fail' : 'warn',
    detail: fontId ? `${fontLabel(fontId)} is not installed in ${dir}` : `no Nerd Font found`,
    ...(fontId ? { fix: { kind: 'reinstall-font' as const, fontId } } : {}),
  };
}

/** Accepts a variant of the family (e.g. the "Mono" width) as a match. */
function familyMatches(actual: string, expected: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();
  const a = normalize(actual);
  const b = normalize(expected);
  return a === b || a.startsWith(b) || b.startsWith(a);
}

export async function checkFontSelected(
  state: WizardState | null,
  deps: DoctorDeps
): Promise<DoctorFinding> {
  const fontId = state ? fontIdToInstall(state.nerdFontToInstall) : null;
  if (state && !fontId) {
    return {
      id: 'font-selected',
      title: 'Terminal font',
      status: 'pass',
      detail: 'no Nerd Font selected — nothing to verify',
    };
  }
  if (await deps.isContainer()) {
    return {
      id: 'font-selected',
      title: 'Terminal font',
      status: 'pass',
      detail: 'containers skip terminal font wiring',
    };
  }
  const terminalId = await deps.detectTerminal();
  if (!terminalId) {
    return {
      id: 'font-selected',
      title: 'Terminal font',
      status: 'warn',
      detail: 'no supported terminal detected — cannot verify the font is selected',
    };
  }

  const label = TERMINAL_LABELS[terminalId];
  const expectedFamily = fontId ? getFontFamily(fontId) : null;
  const wireFix: DoctorFix | undefined = expectedFamily
    ? { kind: 'wire-font', terminalId, family: expectedFamily }
    : undefined;

  if (terminalId === 'wezterm') {
    return {
      id: 'font-selected',
      title: 'Terminal font',
      status: 'warn',
      detail: `WezTerm's config is Lua — check it selects ${expectedFamily ?? 'a Nerd Font'}`,
    };
  }

  if (await deps.hasBundledNerdFonts(terminalId)) {
    return {
      id: 'font-selected',
      title: 'Terminal font',
      status: 'pass',
      detail: `${label} draws Nerd Font symbols itself`,
    };
  }

  const family = deps.readFontFamily(terminalId);
  if (!family) {
    return {
      id: 'font-selected',
      title: 'Terminal font',
      status: 'warn',
      detail: `${label} has no font set`,
      ...(wireFix ? { fix: wireFix } : {}),
    };
  }
  if (expectedFamily && !familyMatches(family, expectedFamily)) {
    return {
      id: 'font-selected',
      title: 'Terminal font',
      status: 'warn',
      detail: `${label} uses "${family}", expected "${expectedFamily}"`,
      ...(wireFix ? { fix: wireFix } : {}),
    };
  }
  return /nerd font/i.test(family)
    ? {
        id: 'font-selected',
        title: 'Terminal font',
        status: 'pass',
        detail: `${label} uses "${family}"`,
      }
    : {
        id: 'font-selected',
        title: 'Terminal font',
        status: 'warn',
        detail: `${label} uses "${family}", which is not a Nerd Font`,
        ...(wireFix ? { fix: wireFix } : {}),
      };
}
