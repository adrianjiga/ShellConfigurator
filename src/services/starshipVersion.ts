export const MIN_STARSHIP_VERSION = '1.20.0';

function parts(version: string): number[] | null {
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : null;
}

/** Whether `version` (as `starship -V` prints it) is older than the generated config needs. */
export function starshipTooOld(version: string | null | undefined): boolean {
  const have = version ? parts(version) : null;
  const need = parts(MIN_STARSHIP_VERSION)!;
  if (!have) return false;
  for (let i = 0; i < need.length; i++) {
    if (have[i] !== need[i]) return have[i] < need[i];
  }
  return false;
}

export function tooOldNote(version: string): string {
  return `${version.trim()} is older than ${MIN_STARSHIP_VERSION}, which the generated config needs: upgrade Starship, or the prompt may not load`;
}
