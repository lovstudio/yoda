import type { ParadigmKindId } from '@shared/paradigms/contract';
import { appBuildLauncher } from './kinds/app-build/launch';
import { compareLauncher } from './kinds/compare/launch';
import { reviewLauncher } from './kinds/review/launch';
import { singleLauncher } from './kinds/single/launch';
import { specLauncher } from './kinds/spec/launch';
import { teamLauncher } from './kinds/team/launch';
import type { ParadigmLauncher } from './launch-context';

/**
 * Every paradigm kind's runtime half. Adding a kind means adding a directory and
 * one line here — the composer only ever looks a launcher up by kind id.
 */
export const PARADIGM_LAUNCHERS: Record<ParadigmKindId, ParadigmLauncher> = {
  single: singleLauncher,
  spec: specLauncher,
  review: reviewLauncher,
  'app-build': appBuildLauncher,
  team: teamLauncher,
  compare: compareLauncher,
};

export function paradigmLauncher(kindId: ParadigmKindId): ParadigmLauncher {
  return PARADIGM_LAUNCHERS[kindId];
}
