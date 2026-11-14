import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fishQuote, posixShellQuote } from '../../config/shells.ts';
import { hasBinary } from '../helpers/binaries.ts';

const VALUE = "/Users/J Doe/$bin/it's a \\\\share\\";

describe('quoting a path for an rc file', () => {
  it.skipIf(!hasBinary('fish'))(
    'gives fish back the exact path, backslashes and quotes included',
    () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-fish-'));
      try {
        const out = spawnSync('fish', ['--no-config', '-c', `printf %s ${fishQuote(VALUE)}`], {
          encoding: 'utf8',
          env: {
            ...process.env,
            HOME: home,
            XDG_CONFIG_HOME: path.join(home, 'config'),
            XDG_DATA_HOME: path.join(home, 'data'),
          },
        });
        expect(out.stdout).toBe(VALUE);
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    }
  );

  it('gives sh back the exact path', () => {
    const out = spawnSync('sh', ['-c', `printf %s ${posixShellQuote(VALUE)}`], {
      encoding: 'utf8',
    });
    expect(out.stdout).toBe(VALUE);
  });
});
