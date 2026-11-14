import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewScreen } from '../../screens/ReviewScreen.tsx';
import { plannedPathDir } from '../../services/installer.ts';
import { explainPromptAsync } from '../../services/starshipProbe.ts';
import { DEFAULT_STATE } from '../../types.ts';
import { pressEsc } from '../helpers/ink.ts';
import { flush } from '../helpers/wait.ts';

vi.mock('../../services/installer.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/installer.ts')>()),
  plannedPathDir: vi.fn(() => null),
}));

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-review-'));
  vi.stubEnv('HOME', home);
  vi.stubEnv('XDG_CONFIG_HOME', undefined);
  vi.stubEnv('ZDOTDIR', undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

function setup(overrides: Partial<typeof DEFAULT_STATE> = {}) {
  const state = {
    ...DEFAULT_STATE,
    selectedShells: ['zsh'] as typeof DEFAULT_STATE.selectedShells,
    installedShells: ['zsh'] as typeof DEFAULT_STATE.installedShells,
    ...overrides,
  };
  const onNext = vi.fn();
  const onBack = vi.fn();
  const instance = render(<ReviewScreen state={state} onNext={onNext} onBack={onBack} />);
  return { instance, onNext, onBack, state };
}

describe('ReviewScreen', () => {
  it('lists the install plan and the config to write for the selected shells', async () => {
    const { instance } = setup();
    await flush();

    const frame = instance.lastFrame();
    expect(frame).toContain('Review your configuration');
    expect(frame).toContain('This run will');
    expect(frame).toContain('Starship');
    expect(frame).toContain('Write config files');
    expect(frame).toContain('Configure zsh');

    expect(frame).toContain('Configuration to write');
    // The per-shell config path, the rc export, and the generated TOML. Assert on
    // space-free tokens because ink wraps long lines at the narrow test terminal.
    expect(frame).toContain('starship/zsh.toml (Zsh)');
    expect(frame).toContain("STARSHIP_CONFIG='");
    expect(frame).toContain('eval "$(starship init zsh)"');
    expect(frame).toContain('$directory$git_branch$git_status');
  });

  it('does not list a starship task when the user chose to skip it', async () => {
    const { instance } = setup({ skipStarshipInstall: true });
    await flush();

    // "Starship prompt wizard" is the header, so match the task bullet specifically.
    expect(instance.lastFrame()).not.toContain('• Starship');
  });

  it('lists a missing shell as something the run will install', async () => {
    const { instance } = setup({ installedShells: [] });
    await flush();

    expect(instance.lastFrame()).toContain('Install zsh');
  });

  it('shows the manual setup command for shells without an rc file', async () => {
    const { instance } = setup({ selectedShells: ['nushell'] });
    await flush();

    const frame = instance.lastFrame();
    expect(frame).toContain('starship/nushell.toml (Nushell)');
    // Space-free tokens: the nushell init command is long and gets wrapped.
    expect(frame).toContain('vendor/autoload');
    expect(frame).toContain('$env.STARSHIP_CONFIG');
  });

  it('previews the config to keep and its rc wiring in adopt mode', async () => {
    const { instance } = setup({
      keepExistingConfig: true,
      sharedConfigToml: '[character]\nsuccess_symbol = "…"\n',
    });
    await flush();

    const frame = instance.lastFrame();
    expect(frame).toContain('Config to keep');
    expect(frame).toContain('Keep existing Starship config');
    expect((frame ?? '').replace(/\s+/g, ' ')).toContain('starship.toml (shared by every shell)');
    expect(frame).toContain('success_symbol = "…"');
    expect(frame).toContain('starship init zsh');
    // Adopt mode wires the shell to the shared config: no per-shell export, and
    // never a freshly generated TOML in the review.
    expect(frame).not.toContain('STARSHIP_CONFIG=');
    expect(frame).not.toContain('$directory$git_branch$git_status');
    // One shared block, however many shells read it.
    expect(frame?.match(/shared by every/g)).toHaveLength(1);
  });

  it('notes that an adopted config with no import is kept as-is', async () => {
    const { instance } = setup({ keepExistingConfig: true });
    await flush();

    const frame = instance.lastFrame();
    expect(frame).toContain('Config to keep');
    expect(frame).toContain('will be kept as-is');
    expect(frame).not.toContain('$directory$git_branch$git_status');
  });

  it('lists a chosen Nerd Font as part of the install plan', async () => {
    const { instance } = setup({ nerdFontToInstall: { kind: 'install', id: 'JetBrainsMono' } });
    await flush();

    expect(instance.lastFrame()).toContain('Nerd Font (JetBrains Mono)');
  });

  it('says what a failed font install would write instead', async () => {
    const { instance } = setup({
      hasNerdFont: true,
      nerdFontToInstall: { kind: 'install', id: 'JetBrainsMono' },
    });
    await flush();
    expect((instance.lastFrame() ?? '').replace(/\s+/g, ' ')).toContain(
      'If the Nerd Font install fails, the config is written without Nerd Font glyphs instead.'
    );
  });

  it('does not promise a font download inside a container', async () => {
    const { instance } = setup({
      container: true,
      nerdFontToInstall: { kind: 'install', id: 'JetBrainsMono' },
    });
    await flush();

    expect(instance.lastFrame()).not.toContain('JetBrains Mono');
  });

  it('confirms with Enter', async () => {
    const { instance, onNext } = setup();
    await flush();

    instance.stdin.write('\r');
    await flush();
    expect(onNext).toHaveBeenCalled();
  });

  it('does not start the run on a stray Space or Tab', async () => {
    const { instance, onNext } = setup();
    await flush();

    instance.stdin.write(' ');
    instance.stdin.write('\t');
    await flush();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('goes back with Esc', async () => {
    const { instance, onBack } = setup();
    await flush();

    await pressEsc(instance.stdin);
    expect(onBack).toHaveBeenCalled();
  });

  it('warns that nothing will be applied in dry-run mode', async () => {
    const { instance } = setup({ dryRun: true });
    await flush();

    expect(instance.lastFrame()).toContain('--dry-run');
  });
});

describe('ReviewScreen manual shells', () => {
  it('shows the setup command before the note that refers to it', async () => {
    const { instance } = setup({ selectedShells: ['powershell'], installedShells: ['powershell'] });
    await flush();
    const frame = instance.lastFrame() ?? '';
    expect(frame.indexOf('starship init powershell')).toBeLessThan(frame.indexOf('$PROFILE'));
  });
});

describe('ReviewScreen dry run', () => {
  it('does not promise an install in the key hint', async () => {
    const { instance } = setup({ dryRun: true });
    await flush();
    expect(instance.lastFrame()).toContain('finish the dry run');
    expect(instance.lastFrame()).not.toMatch(/Enter\s+install/);
  });
});

describe('ReviewScreen with several shells', () => {
  it('prints the generated TOML once and the rc wiring for each shell', async () => {
    const { instance } = setup({
      selectedShells: ['zsh', 'bash'],
      installedShells: ['zsh', 'bash'],
    });
    await flush();
    const frame = instance.lastFrame() ?? '';
    expect(frame.match(/\$directory\$git_branch\$git_status/g)).toHaveLength(1);
    expect(frame).toContain('starship init zsh');
    expect(frame).toContain('starship init bash');
  });
});

describe('ReviewScreen without Starship', () => {
  it('does not promise rc changes that the skipped install will not make', async () => {
    const { instance } = setup({ skipStarshipInstall: true });
    await flush();
    const frame = (instance.lastFrame() ?? '').replace(/\s+/g, ' ');
    expect(frame).toContain('Starship is skipped');
    expect(frame).not.toContain('Everything below will be installed');
    expect(frame).not.toContain('eval "$(starship init zsh)"');
  });
});

describe('ReviewScreen PATH line', () => {
  it('shows the PATH line a script install will add before the init line', async () => {
    vi.mocked(plannedPathDir).mockReturnValueOnce('/home/u/.local/bin');
    const { instance } = setup();
    await flush();
    const frame = instance.lastFrame() ?? '';
    expect(frame).toContain(`export PATH='/home/u/.local/bin':"$PATH"`);
    expect(frame.indexOf('export PATH=')).toBeLessThan(frame.indexOf('starship init zsh'));
  });
});

describe('ReviewScreen with an existing shared config', () => {
  it('warns that the shared config stops applying to the chosen shells', async () => {
    fs.mkdirSync(path.join(home, '.config'));
    fs.writeFileSync(path.join(home, '.config', 'starship.toml'), 'format = "$all"\n');
    const { instance } = setup();
    await flush();
    expect((instance.lastFrame() ?? '').replace(/\s+/g, ' ')).toContain('apply --adopt');
  });
});

describe('ReviewScreen against the files on disk', () => {
  it('shows where the block goes in an existing rc and lists every file the run writes', async () => {
    fs.writeFileSync(path.join(home, '.zshrc'), 'alias ll="ls -l"\n');
    const { instance } = setup();
    await flush();
    const frame = instance.lastFrame() ?? '';
    const flat = frame.replace(/\s+/g, ' ');
    expect(flat).toContain('Config and rc files');
    expect(flat).toContain('create ~/.config/starship/zsh.toml (+');
    expect(flat).toContain('edit ~/.zshrc (+4 -0)');
    expect(frame).toContain(' alias ll="ls -l"');
    expect(frame).toContain('+# Added by ShellConfigurator');
    expect(frame).toContain('+eval "$(starship init zsh)"');
  });

  it('says an rc that is already set up stays as it is', async () => {
    fs.writeFileSync(path.join(home, '.zshrc'), 'eval "$(starship init zsh)"\n');
    const { instance } = setup({ keepExistingConfig: true });
    await flush();
    const frame = (instance.lastFrame() ?? '').replace(/\s+/g, ' ');
    expect(frame).toContain('already set up: the file stays as it is');
    expect(frame).toContain('No config or rc file changes.');
  });
});

describe('ReviewScreen explain', () => {
  it('asks Starship once and toggles why each part of the prompt shows with e', async () => {
    vi.mocked(explainPromptAsync).mockResolvedValueOnce({
      mode: 'real',
      items: [
        { output: '~/projects', description: 'The current working directory' },
        { output: 'on main', description: 'The active branch of the current Git repo' },
      ],
    });
    const { instance } = setup();
    await flush();
    expect(instance.lastFrame()).toContain('explain the prompt');
    expect(instance.lastFrame()).not.toContain('Why each part');

    instance.stdin.write('e');
    await flush();
    const frame = instance.lastFrame() ?? '';
    expect(frame).toContain('Why each part of the prompt shows');
    expect(frame).toContain('The current working directory');
    expect(frame).toContain('hide the explanation');

    instance.stdin.write('e');
    await flush();
    expect(instance.lastFrame()).not.toContain('Why each part');
    instance.stdin.write('e');
    await flush();
    expect(instance.lastFrame()).toContain('The active branch');
    expect(explainPromptAsync).toHaveBeenCalledOnce();
  });

  it('lines up the descriptions after icons outside the basic plane, and repeated rows', async () => {
    vi.mocked(explainPromptAsync).mockResolvedValueOnce({
      mode: 'real',
      items: [
        { output: '\u{F024B} x', description: 'First' },
        { output: 'abc', description: 'Second' },
        { output: 'abc', description: 'Second' },
      ],
    });
    const { instance } = setup();
    await flush();
    instance.stdin.write('e');
    await flush();
    const lines = (instance.lastFrame() ?? '').split('\n');
    const column = (word: string) => {
      const line = lines.find((candidate) => candidate.includes(word))!;
      return [...line.slice(0, line.indexOf(word))].length;
    };
    expect(column('First')).toBe(column('Second'));
    expect(lines.filter((line) => line.includes('Second'))).toHaveLength(2);
  });

  it('says why there is no explanation when Starship cannot give one', async () => {
    const { instance } = setup();
    await flush();
    instance.stdin.write('e');
    await flush();
    expect((instance.lastFrame() ?? '').replace(/\s+/g, ' ')).toContain(
      'Starship is not installed yet, so it cannot explain the prompt.'
    );
  });

  it('offers no explanation in adopt mode, where no config is generated', async () => {
    const { instance } = setup({ keepExistingConfig: true });
    await flush();
    instance.stdin.write('e');
    await flush();
    expect(instance.lastFrame()).not.toContain('explain the prompt');
    expect(instance.lastFrame()).not.toContain('Why each part');
    expect(explainPromptAsync).not.toHaveBeenCalled();
  });
});
