import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { fishQuote, posixShellQuote } from '../../config/shells.ts';

const VALUE = "/Users/J Doe/$bin/it's a \\\\share\\";
const has = (shell: string) => !spawnSync(shell, ['-c', 'true']).error;

describe('quoting a path for an rc file', () => {
  it.skipIf(!has('fish'))('gives fish back the exact path, backslashes and quotes included', () => {
    const out = spawnSync('fish', ['--no-config', '-c', `printf %s ${fishQuote(VALUE)}`], {
      encoding: 'utf8',
    });
    expect(out.stdout).toBe(VALUE);
  });

  it('gives sh back the exact path', () => {
    const out = spawnSync('sh', ['-c', `printf %s ${posixShellQuote(VALUE)}`], {
      encoding: 'utf8',
    });
    expect(out.stdout).toBe(VALUE);
  });
});
