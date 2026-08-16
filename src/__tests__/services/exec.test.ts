import { vi, describe, it, expect, beforeEach } from 'vitest';

const { mockExecFileSync, mockSpawnSync } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
  mockSpawnSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFileSync: mockExecFileSync,
  spawnSync: mockSpawnSync,
  execFile: Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: vi.fn(),
  }),
}));

import { commandExists, commandPath, runCommand } from '../../services/exec.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockExecFileSync.mockReturnValue('');
  mockSpawnSync.mockReturnValue({ status: 0 });
});

describe('commandExists', () => {
  it('passes the command as an argument rather than splicing it into the script', () => {
    commandExists('curl');

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'sh',
      ['-c', 'command -v "$1"', 'sh', 'curl'],
      expect.anything()
    );
  });

  it('does not let a crafted name become shell syntax', () => {
    commandExists('curl; rm -rf /');

    const args = mockExecFileSync.mock.calls[0]?.[1] as string[];
    // The dangerous text is data in $1, never part of the script itself.
    expect(args[1]).toBe('command -v "$1"');
    expect(args[3]).toBe('curl; rm -rf /');
  });

  it('reports false when the lookup fails', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    expect(commandExists('nope')).toBe(false);
  });
});

describe('commandPath', () => {
  it('returns the trimmed path', () => {
    mockExecFileSync.mockReturnValue('/usr/bin/zsh\n');
    expect(commandPath('zsh')).toBe('/usr/bin/zsh');
  });

  it('returns null when the command is absent', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    expect(commandPath('zsh')).toBeNull();
  });
});

describe('runCommand', () => {
  it('rejects an empty command', () => {
    expect(() => runCommand([])).toThrow('Empty command');
  });

  it('throws on a non-zero exit', () => {
    mockSpawnSync.mockReturnValue({ status: 3 });
    expect(() => runCommand(['false'])).toThrow('exit code 3');
  });

  it('throws when killed by a signal', () => {
    mockSpawnSync.mockReturnValue({ signal: 'SIGTERM', status: null });
    expect(() => runCommand(['sleep'])).toThrow('killed by signal SIGTERM');
  });
});
