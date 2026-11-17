import type { WizardState } from '../../types.ts';
import { starshipTooOld, tooOldNote } from '../starshipVersion.ts';
import type { DoctorDeps, DoctorFinding, StarshipProbe } from './types.ts';

export async function probeStarship(deps: DoctorDeps): Promise<StarshipProbe> {
  const probe = await deps.isStarshipInstalled();
  if (probe.installed) return probe;
  const pathDir = deps.getMissingStarshipPathDir();
  if (!pathDir) return probe;
  const version = await deps.readStarshipVersion(pathDir);
  return version ? { installed: true, version, pathDir } : probe;
}

export function checkStarship(probe: StarshipProbe, state: WizardState | null): DoctorFinding {
  if (probe.installed && starshipTooOld(probe.version)) {
    return {
      id: 'starship',
      title: 'Starship',
      status: 'warn',
      detail: tooOldNote(probe.version!),
    };
  }
  if (probe.installed) {
    return {
      id: 'starship',
      title: 'Starship',
      status: 'pass',
      detail: probe.pathDir
        ? `${probe.version ?? 'installed'} (in ${probe.pathDir}, not on PATH until you restart)`
        : (probe.version ?? 'installed'),
    };
  }
  return {
    id: 'starship',
    title: 'Starship',
    status: 'fail',
    detail: 'starship is not on PATH',
    ...(state?.skipStarshipInstall ? {} : { fix: { kind: 'reinstall-starship' as const } }),
  };
}

/**
 * The version-drift check: does the installed starship match the version the
 * last fresh install recorded? A mismatch means a package-manager upgrade or
 * downgrade happened outside the tool.
 */
export function checkVersionDrift(probe: StarshipProbe, deps: DoctorDeps): DoctorFinding {
  const cached = deps.readCachedStarshipVersion();
  if (!cached) {
    return {
      id: 'version-drift',
      title: 'Starship version',
      status: 'pass',
      detail: 'no prior install recorded to compare against',
    };
  }
  const { installed, version } = probe;
  if (!installed || !version) {
    return {
      id: 'version-drift',
      title: 'Starship version',
      status: 'warn',
      detail: `last run recorded ${cached}, but starship is not reachable now`,
    };
  }
  return version === cached
    ? { id: 'version-drift', title: 'Starship version', status: 'pass', detail: cached }
    : {
        id: 'version-drift',
        title: 'Starship version',
        status: 'warn',
        detail: `installed ${version}; the last install recorded ${cached}`,
      };
}
