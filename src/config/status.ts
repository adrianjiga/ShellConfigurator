import type { InstallStatus } from '../types.ts';

export interface StatusMark {
  /** The glyph drawn inline. Bracketed frames are the caller's presentation. */
  icon: string;
  color: string;
}

/**
 * The single source for how every install status is drawn. InstallingScreen
 * frames the glyph in brackets; DoneScreen draws it bare — both read from here.
 */
export const STATUS_MARKS: Record<InstallStatus, StatusMark> = {
  pending: { icon: ' ', color: 'gray' },
  running: { icon: '~', color: 'yellow' },
  done: { icon: '✓', color: 'green' },
  failed: { icon: '✗', color: 'red' },
  skipped: { icon: '–', color: 'gray' },
};

/** 'unknown' means no result was recorded — the task never ran or the run was cut short. */
export type ReportedStatus = InstallStatus | 'unknown';

/** Fallback for an unrecorded status: never default a missing result to success. */
export const UNKNOWN_STATUS_MARK: StatusMark = { icon: '?', color: 'yellow' };

export function statusMark(status: ReportedStatus): StatusMark {
  return status === 'unknown' ? UNKNOWN_STATUS_MARK : STATUS_MARKS[status];
}
