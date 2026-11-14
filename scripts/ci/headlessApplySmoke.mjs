#!/usr/bin/env node
import * as nodePath from 'node:path';
import {
  assertApplyVerified,
  assertRcWired,
  assertUninstalled,
  assertWhatChanged,
  readOrNull,
  requireScratchHome,
  runCli,
  runSmoke,
  shellConfigPath,
} from './smokeHome.mjs';

// Headless-apply CI leg: drive the real `apply` subcommand and assert the
// post-install `Verify config` task actually ran and succeeded.
const homeDir = requireScratchHome();

// A script install (wizardSmoke, or apt/dnf here) lands in ~/.local/bin; the
// apply process must see it or it would try to reinstall instead of verifying.
process.env.PATH = `${nodePath.join(homeDir, '.local', 'bin')}:${process.env.PATH}`;

await runSmoke('Headless apply smoke', () => {
  const bashrc = nodePath.join(homeDir, '.bashrc');
  const before = { rc: readOrNull(bashrc), config: readOrNull(shellConfigPath('bash')) };

  const out = runCli(['apply', '--shells', 'bash', '--no-nerd-font']);

  assertApplyVerified(out);
  assertRcWired(bashrc, 'bash');
  assertWhatChanged(out, bashrc);
  assertUninstalled(homeDir, bashrc, 'bash', before);
});
