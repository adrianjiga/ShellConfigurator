import { MODULES } from '../config/modules.ts';
import { PRESETS } from '../config/presets.ts';
import { NERD_FONTS } from './installer.ts';

export type ListKind = 'presets' | 'modules' | 'fonts';

export interface ListEntry {
  id: string;
  label: string;
  description?: string;
  [extra: string]: unknown;
}

export function listEntries(kind: ListKind): ListEntry[] {
  switch (kind) {
    case 'presets':
      return PRESETS.map((preset) => ({
        id: preset.id,
        label: preset.label,
        description: preset.description,
        palette: preset.palette,
        powerline: preset.powerline,
        requiresNerdFont: preset.requiresNerdFont,
        leftModules: [...preset.leftModules],
        rightModules: [...preset.rightModules],
      }));
    case 'modules':
      return MODULES.map((module) => ({
        id: module.id,
        label: module.label,
        description: module.description,
        defaultLeft: module.defaultLeft,
        defaultRight: module.defaultRight,
      }));
    case 'fonts':
      return NERD_FONTS.map((font) => ({
        id: font.id,
        label: font.label,
        family: font.family,
      }));
  }
}

export function formatListing(entries: ListEntry[]): string {
  const width = Math.max(0, ...entries.map((entry) => entry.id.length));
  const lines = entries.map((entry) => {
    const detail = entry.description ? ` — ${entry.description}` : '';
    return `${entry.id.padEnd(width)}  ${entry.label}${detail}`;
  });
  return `${lines.join('\n')}\n`;
}
