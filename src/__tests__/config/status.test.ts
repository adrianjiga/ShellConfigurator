import { describe, expect, it } from 'vitest';
import { STATUS_MARKS, statusLine, statusMark } from '../../config/status.ts';

describe('statusMark', () => {
  it('draws an unrecorded result as a yellow question mark, never as success', () => {
    expect(statusMark('unknown')).toEqual({ icon: '?', color: 'yellow' });
  });

  it('draws every recorded status from the shared table', () => {
    for (const [status, mark] of Object.entries(STATUS_MARKS)) {
      expect(statusMark(status as keyof typeof STATUS_MARKS)).toBe(mark);
    }
  });
});

describe('statusLine', () => {
  it('upper-cases the status into a fixed-width column', () => {
    expect(statusLine('ok', 'Starship')).toBe('OK      Starship');
    expect(statusLine('planned', 'Zsh')).toBe('PLANNED Zsh');
  });
});
