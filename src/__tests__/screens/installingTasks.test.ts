import { describe, it, expect } from 'vitest';
import { buildTaskList } from '../../screens/InstallingScreen.js';
import { DEFAULT_STATE, FONT_SELECT_SENTINEL } from '../../types.js';

describe('buildTaskList', () => {
  it('includes starship, config, and rc tasks by default', () => {
    const tasks = buildTaskList(DEFAULT_STATE);
    expect(tasks.map((t) => t.id)).toContain('starship');
    expect(tasks.map((t) => t.id)).toContain('config');
    expect(tasks.map((t) => t.id)).toContain('rc');
  });

  it('omits the starship task when skipStarshipInstall is set', () => {
    const tasks = buildTaskList({ ...DEFAULT_STATE, skipStarshipInstall: true });
    expect(tasks.map((t) => t.id)).not.toContain('starship');
  });

  it('omits the font task when nerdFontToInstall is null', () => {
    const tasks = buildTaskList({ ...DEFAULT_STATE, nerdFontToInstall: null });
    expect(tasks.map((t) => t.id)).not.toContain('font');
  });

  it('omits the font task for the font_select sentinel value', () => {
    const tasks = buildTaskList({ ...DEFAULT_STATE, nerdFontToInstall: FONT_SELECT_SENTINEL });
    expect(tasks.map((t) => t.id)).not.toContain('font');
  });

  it('adds a font task with the font label for a concrete font id', () => {
    const tasks = buildTaskList({ ...DEFAULT_STATE, nerdFontToInstall: 'JetBrainsMono' });
    const font = tasks.find((t) => t.id === 'font');
    expect(font?.label).toBe('Nerd Font (JetBrains Mono)');
    expect(font?.status).toBe('pending');
  });

  it('falls back to the raw id when the font is unknown', () => {
    const tasks = buildTaskList({ ...DEFAULT_STATE, nerdFontToInstall: 'SomeFont' });
    expect(tasks.find((t) => t.id === 'font')?.label).toBe('Nerd Font (SomeFont)');
  });

  it('adds shell install tasks only for shells not already installed', () => {
    const tasks = buildTaskList({
      ...DEFAULT_STATE,
      selectedShells: ['zsh', 'bash'],
      installedShells: ['zsh'],
    });
    const ids = tasks.map((t) => t.id);
    expect(ids).not.toContain('shell_zsh');
    expect(ids).toContain('shell_bash');
  });

  it('does not add shell install tasks when all selected shells are installed', () => {
    const tasks = buildTaskList({
      ...DEFAULT_STATE,
      selectedShells: ['zsh'],
      installedShells: ['zsh'],
    });
    expect(tasks.map((t) => t.id)).not.toContain('shell_zsh');
  });

  it('adds a chsh task when a default shell is selected', () => {
    const tasks = buildTaskList({ ...DEFAULT_STATE, setDefaultShell: 'zsh' });
    const chsh = tasks.find((t) => t.id === 'chsh');
    expect(chsh?.label).toBe('Set zsh as default shell');
  });

  it('omits the chsh task when no default shell is selected', () => {
    const tasks = buildTaskList({ ...DEFAULT_STATE, setDefaultShell: null });
    expect(tasks.map((t) => t.id)).not.toContain('chsh');
  });

  it('builds the full task set for a complete run', () => {
    const tasks = buildTaskList({
      ...DEFAULT_STATE,
      selectedShells: ['zsh', 'bash'],
      installedShells: ['zsh'],
      nerdFontToInstall: 'FiraCode',
      setDefaultShell: 'zsh',
    });
    const ids = tasks.map((t) => t.id);
    expect(ids).toEqual(['starship', 'font', 'shell_bash', 'chsh', 'config', 'rc']);
    expect(tasks.every((t) => t.status === 'pending')).toBe(true);
  });
});
