import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.unmock('../../services/starshipProbe.ts');

import { generateToml } from '../../generators/starship.ts';
import {
  explainPromptAsync,
  type ProbeDeps,
  parseExplain,
  parseTimings,
  StarshipMissingError,
  StarshipTimedOutError,
  stripAnsi,
  suggestFixes,
  timePrompt,
} from '../../services/starshipProbe.ts';
import { DEFAULT_STATE } from '../../types.ts';

const ESC = String.fromCharCode(27);

const TIMINGS = `
 Here are the timings of modules in your prompt (>=1ms or output):
 directory   -  206ms  -   "${ESC}[1;38;2;122;162;247m proj${ESC}[0m "
 nodejs      -   14ms  -   "via ${ESC}[1;32m v22.19.0 ${ESC}[0m"
 git_status  -   1.2s  -   "${ESC}[1;31m[?1]${ESC}[0m "
 character   -   <1ms  -   "${ESC}[1;32m❯${ESC}[0m "
`;

const EXPLAIN = `
 Here's a breakdown of your prompt:
 ${ESC}[1;32m❯${ESC}[0m                -  A character (usually an arrow) beside where the text is entered in your terminal
 ${ESC}[1;36m~/proj${ESC}[0m   -  The current working directory
 on ${ESC}[1;35m main${ESC}[0m        -  The active branch of the current Git repo
`;

describe('parseTimings', () => {
  it('reads each module, its time in ms and its plain output, slowest first', () => {
    expect(parseTimings(TIMINGS)).toEqual([
      { module: 'git_status', ms: 1200, output: '[?1] ' },
      { module: 'directory', ms: 206, output: ' proj ' },
      { module: 'nodejs', ms: 14, output: 'via  v22.19.0 ' },
      { module: 'character', ms: 0, output: '❯ ' },
    ]);
  });
});

describe('parseExplain', () => {
  it('joins a description Starship wrapped onto the next line', () => {
    const wrapped = `
 Here's a breakdown of your prompt:
 ~/proj   -  The current working directory, shortened to the
             repository root
 ❯        -  The prompt character
`;
    expect(parseExplain(wrapped)).toEqual([
      {
        output: '~/proj',
        description: 'The current working directory, shortened to the repository root',
      },
      { output: '❯', description: 'The prompt character' },
    ]);
  });

  it('reads what each segment shows and why', () => {
    expect(parseExplain(EXPLAIN)).toEqual([
      {
        output: '❯',
        description:
          'A character (usually an arrow) beside where the text is entered in your terminal',
      },
      { output: '~/proj', description: 'The current working directory' },
      { output: 'on  main', description: 'The active branch of the current Git repo' },
    ]);
  });
});

describe('stripAnsi', () => {
  it('drops colour, cursor and hyperlink escapes', () => {
    const BEL = String.fromCharCode(7);
    expect(
      stripAnsi(
        `${ESC}[1;32m❯${ESC}[0m ${ESC}]8;;file:///tmp/p${ESC}\\p${ESC}]8;;${ESC}\\ ${ESC}]8;;https://x${BEL}x${ESC}]8;;${BEL}${ESC}[2K`
      )
    ).toBe('❯ p x');
  });
});

describe('suggestFixes', () => {
  const timing = (module: string, ms: number) => ({ module, ms, output: '' });

  it('suggests something for each slow module, and nothing for fast ones', () => {
    const suggestions = suggestFixes(
      [timing('git_status', 300), timing('nodejs', 80), timing('aws', 60), timing('character', 2)],
      '',
      ''
    );
    expect(suggestions.map((s) => s.module)).toEqual(['git_status', 'nodejs', 'aws']);
    expect(suggestions[0].text).toContain('core.fsmonitor');
    expect(suggestions[1]).toMatchObject({ toml: '[nodejs]\ndisabled = true' });
    expect(suggestions[1].text).toContain('version command');
  });

  it('raises command_timeout from the config when a command timed out', () => {
    const warnings = `[${ESC}[33mWARN${ESC}[0m] - (starship::utils): Executing command "/usr/bin/node" timed out.`;
    expect(
      suggestFixes([], warnings, 'command_timeout = 800\n[nodejs]\ncommand_timeout = 1\n')
    ).toEqual([expect.objectContaining({ toml: 'command_timeout = 1600' })]);
    expect(suggestFixes([], warnings, '')[0]).toMatchObject({
      text: expect.stringContaining(
        'node did not answer within command_timeout (500ms), so its module'
      ),
      toml: 'command_timeout = 1000',
    });
    const two = `${warnings}\n${warnings.replace('/usr/bin/node', '/usr/bin/git')}`;
    expect(suggestFixes([], two, '')[0].text).toContain('node, git did not answer');
    expect(suggestFixes([], two, '')[0].text).toContain('their modules');
  });

  it('reads command_timeout after a multi-line format string, with underscores', () => {
    const warnings = 'Executing command "/usr/bin/node" timed out.';
    const toml =
      'format = """\n[](fg:red)\n$directory\n"""\ncommand_timeout = 2_000 # ms\n[nodejs]\n';
    expect(suggestFixes([], warnings, toml)[0]).toMatchObject({ toml: 'command_timeout = 4000' });
  });

  it('never suggests turning off the modules every prompt needs', () => {
    expect(suggestFixes([timing('character', 90), timing('line_break', 70)], '', '')).toEqual([]);
  });

  it('gives a module whose tool timed out only the timeout advice', () => {
    const warnings = 'Executing command "/usr/bin/node" timed out.';
    const suggestions = suggestFixes([timing('nodejs', 500), timing('aws', 80)], warnings, '');
    expect(suggestions.map((s) => s.module ?? 'command_timeout')).toEqual([
      'command_timeout',
      'aws',
    ]);
  });

  it('raises scan_timeout when the folder scan timed out', () => {
    expect(suggestFixes([], 'Scanning current directory timed out.', '')).toEqual([
      expect.objectContaining({ toml: 'scan_timeout = 100' }),
    ]);
  });

  it('only points at the folder for a slow directory module', () => {
    expect(suggestFixes([timing('directory', 90)], '', '')[0].toml).toBeUndefined();
  });
});

function fakeDeps(
  stdout: string,
  stderr = '',
  installed = true
): ProbeDeps & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    isStarshipInstalled: async () => installed,
    run: async (command, path, configPath) => {
      calls.push([command, path]);
      expect(fs.readFileSync(configPath, 'utf8')).toBe('format = "$all"\n');
      return { stdout, stderr };
    },
  };
}

describe('timePrompt', () => {
  it('times the config in the folder and reports the slowest module and the fixes', async () => {
    const deps = fakeDeps(TIMINGS);
    const report = await timePrompt('format = "$all"\n', '/work/repo', deps);

    expect(deps.calls).toEqual([['timings', '/work/repo']]);
    expect(report).toMatchObject({ path: '/work/repo', slowestMs: 1200, slow: true });
    expect(report.modules).toHaveLength(4);
    expect(report.suggestions.map((s) => s.module)).toEqual(['git_status', 'directory']);
  });

  it('explains a Starship that was killed for taking too long', async () => {
    const deps: ProbeDeps = {
      isStarshipInstalled: async () => true,
      run: async () => {
        throw Object.assign(new Error('Command failed: starship timings'), { killed: true });
      },
    };
    const failure = timePrompt('format = "$all"\n', '/big/repo', deps);
    await expect(failure).rejects.toBeInstanceOf(StarshipTimedOutError);
    await expect(failure).rejects.toThrow(/in \/big\/repo within 30s.*git_status/);
  });

  it('refuses to run without Starship', async () => {
    await expect(
      timePrompt('format = "$all"\n', '/', fakeDeps('', '', false))
    ).rejects.toBeInstanceOf(StarshipMissingError);
  });
});

describe('explainPromptAsync', () => {
  const scratchDeps = () => ({
    createScratch: vi.fn(async () => '/scratch'),
    writeConfig: vi.fn(async () => {}),
    scaffoldProject: vi.fn(async () => '/scratch/projects/myapp'),
    cleanup: vi.fn(async () => {}),
  });

  it('explains the generated config in the sample project, then removes the scratch folder', async () => {
    const calls: string[][] = [];
    const scratch = scratchDeps();
    const result = await explainPromptAsync(
      DEFAULT_STATE,
      {
        isStarshipInstalled: async () => true,
        run: async (command, path, configPath, home) => {
          calls.push([command, path, configPath, home ?? '']);
          return { stdout: EXPLAIN, stderr: '' };
        },
      },
      scratch
    );
    expect(result).toEqual({ mode: 'real', items: parseExplain(EXPLAIN) });
    expect(calls).toEqual([
      ['explain', '/scratch/projects/myapp', path.join('/scratch', 'starship.toml'), '/scratch'],
    ]);
    expect(scratch.writeConfig).toHaveBeenCalledWith('/scratch', generateToml(DEFAULT_STATE));
    expect(scratch.cleanup).toHaveBeenCalledWith('/scratch');
  });

  it('is unavailable without Starship, or when explain prints nothing or fails', async () => {
    const deps = (run: ProbeDeps['run'], installed = true): ProbeDeps => ({
      isStarshipInstalled: async () => installed,
      run,
    });
    const ok = async () => ({ stdout: '', stderr: '' });
    expect(await explainPromptAsync(DEFAULT_STATE, deps(ok, false), scratchDeps())).toEqual({
      mode: 'unavailable',
      reason: 'starship-missing',
    });
    expect(await explainPromptAsync(DEFAULT_STATE, deps(ok), scratchDeps())).toEqual({
      mode: 'unavailable',
      reason: 'explain-failed',
    });
    const fails = async () => {
      throw new Error('boom');
    };
    const scratch = scratchDeps();
    expect(await explainPromptAsync(DEFAULT_STATE, deps(fails), scratch)).toEqual({
      mode: 'unavailable',
      reason: 'explain-failed',
    });
    expect(scratch.cleanup).toHaveBeenCalledWith('/scratch');
  });
});
