import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import { parse } from '@iarna/toml';

export function die(message) {
  console.error(message);
  process.exit(2);
}

/** True when `dir` is `root` itself or somewhere below it. */
function isWithin(dir, root) {
  return dir === root || dir.startsWith(`${root}${nodePath.sep}`);
}

export function requireScratchHome() {
  if (!process.env.HOME) die('Refusing to run: HOME is not set.');
  const homeDir = nodePath.resolve(process.env.HOME);

  if (!isWithin(homeDir, '/tmp') || homeDir === '/tmp') {
    die(
      `Refusing to run: HOME (${homeDir}) is not a scratch directory under /tmp. This smoke ` +
        'harness writes into and deletes files under HOME. Run it with HOME=/tmp/<something>.'
    );
  }

  // The scratch home may not exist yet (e.g. HOME=/tmp/macos-smoke-home on a
  // fresh runner). Create it so config/rc writes land where expected.
  mkdirSync(homeDir, { recursive: true });
  process.env.HOME = homeDir;

  const xdgDefaults = {
    XDG_CONFIG_HOME: '.config',
    XDG_STATE_HOME: nodePath.join('.local', 'state'),
    XDG_CACHE_HOME: '.cache',
    XDG_DATA_HOME: nodePath.join('.local', 'share'),
  };
  for (const [name, fallback] of Object.entries(xdgDefaults)) {
    const value = process.env[name]?.trim();
    process.env[name] =
      value && isWithin(nodePath.resolve(value), homeDir)
        ? nodePath.resolve(value)
        : nodePath.join(homeDir, fallback);
  }
  return homeDir;
}

const entry = nodePath.resolve('dist/index.js');

/** Runs the built CLI; a failure carries the CLI's own output so CI shows why. */
export function runCli(args) {
  try {
    return execFileSync(process.execPath, [entry, ...args], { encoding: 'utf8' });
  } catch (err) {
    throw new Error(
      `shell-configurator ${args.join(' ')} exited ${err.status}:\n${err.stdout ?? ''}${err.stderr ?? ''}`
    );
  }
}

/** Runs one smoke and exits non-zero with its message when an assertion fails. */
export async function runSmoke(name, body) {
  try {
    await body();
    console.log(`\n${name} passed.`);
  } catch (err) {
    console.error(`FAIL ${name}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/** Asserts the file exists and parses as a Starship config with a format string. */
export function assertStarshipConfig(filePath, label) {
  assert.ok(existsSync(filePath), `${label} was not written`);
  const parsed = /** @type {any} */ (parse(readFileSync(filePath, 'utf8')));
  assert.equal(typeof parsed.format, 'string', `${label} unparseable`);
}

/** Runs `generate` to stdout and with -o/--export, asserting every artifact. */
export function assertGenerate(homeDir, shell) {
  const generated = runCli([
    'generate',
    '--preset',
    'pastel-powerline',
    '--shells',
    shell,
    '--no-nerd-font',
  ]);
  assert.ok(generated.includes('format = "'), 'generate printed no TOML');
  assert.ok(generated.includes('$character'), 'generate missing $character');

  const tomlPath = nodePath.join(homeDir, 'generated.toml');
  const cardPath = nodePath.join(homeDir, 'card.json');
  runCli(['generate', '--preset', 'pastel-powerline', '-o', tomlPath, '--export', cardPath]);
  assert.ok(existsSync(cardPath), 'generate --export did not write the card');
  assertStarshipConfig(tomlPath, 'generate -o TOML');
}

/** Asserts a real `apply` ran the Verify config task and nothing failed. */
export function assertApplyVerified(out) {
  assert.ok(out.includes('Verify config'), `apply plan missing the verify task:\n${out}`);
  assert.match(out, /verified \d+ config\(s\)/, `apply did not verify the config:\n${out}`);
  assert.ok(!out.includes('FAIL'), `apply reported a failed task:\n${out}`);
}

/** Asserts a bash/zsh rc carries the managed block: banner, per-shell export and init line. */
export function assertRcWired(rcPath, shell) {
  const content = readFileSync(rcPath, 'utf8');
  const name = nodePath.basename(rcPath);
  assert.ok(content.includes('# Added by ShellConfigurator'), `${name} missing the banner`);
  assert.ok(content.includes('export STARSHIP_CONFIG='), `${name} missing STARSHIP_CONFIG`);
  assert.ok(content.includes(`eval "$(starship init ${shell})"`), `${name} missing the init line`);
  return content;
}

/**
 * Runs a real `uninstall --yes` for one shell after an apply, then asserts the
 * rc lost every managed line, the per-shell config moved to a backup, a second
 * run finds nothing, a `rollback` brings both back, and a second `rollback`
 * puts both back to `before`, their content ahead of the apply.
 */
export function assertUninstalled(homeDir, rcPath, shell, before) {
  const configPath = shellConfigPath(shell);
  assert.ok(existsSync(configPath), `apply did not write ${configPath}`);

  const out = runCli(['uninstall', '--yes', '--shells', shell]);
  assert.ok(
    out.split('\n').some((line) => line.startsWith('REMOVED') && line.includes(rcPath)),
    `uninstall left the rc:\n${out}`
  );
  const rc = readFileSync(rcPath, 'utf8');
  assert.ok(!rc.includes('ShellConfigurator'), `uninstall left the banner in the rc:\n${rc}`);
  assert.ok(!rc.includes('starship'), `uninstall left Starship lines in the rc:\n${rc}`);
  assert.ok(!existsSync(configPath), `uninstall left ${configPath}`);
  const rcBackups = readdirSync(homeDir).filter((f) =>
    f.startsWith(`${nodePath.basename(rcPath)}.bak-`)
  );
  assert.ok(rcBackups.length > 0, 'uninstall did not back up the rc');

  const again = runCli(['uninstall', '--yes', '--shells', shell]);
  assert.ok(!again.includes('REMOVED'), `a second uninstall removed something:\n${again}`);

  assert.ok(
    out.includes('Undo it with: shell-configurator rollback'),
    `uninstall did not point at rollback:\n${out}`
  );
  const runs = runCli(['rollback', '--list']);
  assert.match(runs, /uninstall .*\(.*next to roll back\)/, `rollback --list:\n${runs}`);

  const undoUninstall = runCli(['rollback', '--yes']);
  assert.ok(!undoUninstall.includes('FAILED'), `rollback failed:\n${undoUninstall}`);
  assertRcWired(rcPath, shell);
  assertStarshipConfig(configPath, 'config after rolling back the uninstall');

  const undoApply = runCli(['rollback', '--yes']);
  assert.ok(!undoApply.includes('FAILED'), `second rollback failed:\n${undoApply}`);
  assert.equal(
    readOrNull(rcPath),
    before.rc,
    `rolling back the apply did not restore the rc:\n${readOrNull(rcPath)}`
  );
  assert.equal(
    readOrNull(configPath),
    before.config,
    `rolling back the apply did not restore ${configPath}`
  );
}

/** The per-shell config path the CLI writes in this scratch home. */
export function shellConfigPath(shell) {
  return nodePath.join(process.env.XDG_CONFIG_HOME, 'starship', `${shell}.toml`);
}

/** A file's text, or null when it does not exist. */
export function readOrNull(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : null;
}

/** Runs the real `debug-info` and asserts the Markdown and JSON reports, with HOME hidden. */
export function assertDebugInfo(homeDir) {
  const report = runCli(['debug-info']);
  assert.match(report, /^# shell-configurator debug info\n/, `debug-info printed:\n${report}`);
  for (const section of ['## Starship', '## Shells', '## PATH', '## Doctor']) {
    assert.ok(report.includes(section), `debug-info is missing ${section}:\n${report}`);
  }
  assert.ok(!report.includes(homeDir), `debug-info shows the home directory:\n${report}`);

  const info = JSON.parse(runCli(['debug-info', '--json']));
  assert.equal(typeof info.packageManager, 'string', 'debug-info --json has no package manager');
  assert.ok(
    Array.isArray(info.shells) && info.shells.length > 0,
    'debug-info --json has no shells'
  );
}

/** Loads the real `completions bash` script into bash and asserts it completes a subcommand and a value. */
export function assertBashCompletions(homeDir) {
  const script = nodePath.join(homeDir, 'shell-configurator.bash');
  writeFileSync(script, runCli(['completions', 'bash']));
  const out = execFileSync(
    'bash',
    [
      '-c',
      `source "$1"
t() { COMP_WORDS=("$@"); COMP_CWORD=$(( $# - 1 )); COMPREPLY=(); _shell_configurator; echo "\${COMPREPLY[*]}"; }
t shell-configurator debug
t shell-configurator generate --character la`,
      'bash',
      script,
    ],
    { encoding: 'utf8' }
  );
  assert.equal(out, 'debug-info\nlambda\n', `bash completions offered:\n${out}`);
}

/** Asserts a real apply wrote WHAT-CHANGED.md naming the rc it changed and the rollback that undoes it. */
export function assertWhatChanged(out, rcPath) {
  const summary = nodePath.join(process.env.XDG_CONFIG_HOME, 'starship', 'WHAT-CHANGED.md');
  assert.ok(
    out.includes(`What changed, and how to undo it: ${summary}`),
    `apply did not point at the summary:\n${out}`
  );
  const text = readFileSync(summary, 'utf8');
  assert.ok(
    text.includes(`\`${rcPath}\``) || text.includes('`~/.bashrc`'),
    `the summary does not list the rc:\n${text}`
  );
  assert.ok(
    text.includes('`shell-configurator rollback`'),
    `the summary does not offer rollback:\n${text}`
  );
}

/** Runs the list flags and `apply --dry-run --json` for real and parses what they print. */
export function assertScriptingSurface() {
  const presets = JSON.parse(runCli(['--list-presets', '--json']));
  assert.ok(
    presets.some((preset) => preset.id === 'tokyo-night'),
    '--list-presets --json has no tokyo-night'
  );
  assert.match(runCli(['--list-fonts']), /^JetBrainsMono\s+JetBrains Mono$/m, '--list-fonts text');

  const bashrc = nodePath.join(process.env.HOME, '.bashrc');
  const bashrcBefore = existsSync(bashrc) ? readFileSync(bashrc, 'utf8') : null;
  const plan = JSON.parse(
    runCli(['apply', '--dry-run', '--json', '--shells', 'bash', '--no-nerd-font'])
  );
  assert.equal(plan.dryRun, true, 'apply --dry-run --json is not a dry-run plan');
  assert.deepEqual(plan.shells, ['bash'], 'apply --dry-run --json has the wrong shells');
  assert.equal(plan.config.kind, 'per-shell', 'apply --dry-run --json has no generated config');
  const rcChange = plan.changes.find((change) => change.path === bashrc);
  assert.ok(rcChange, `apply --dry-run --json has no change for ${bashrc}`);
  assert.match(
    rcChange.diff,
    /^\+eval "\$\(starship init bash\)"$/m,
    'the dry-run diff of .bashrc does not add the init line'
  );
  assert.equal(
    existsSync(bashrc) ? readFileSync(bashrc, 'utf8') : null,
    bashrcBefore,
    'apply --dry-run changed .bashrc'
  );
}
