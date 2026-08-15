import type { ParadigmKindId } from '@shared/paradigms/contract';
import { defaultParadigmStamp, type ParadigmStamp } from '@shared/paradigms/stamp';
import { compareLauncher } from './kinds/compare/launch';
import { singleLauncher } from './kinds/single/launch';
import { teamLauncher } from './kinds/team/launch';
import type { ParadigmLauncher, ParadigmLaunchParams } from './launch-context';

/**
 * Every paradigm kind's runtime half. Adding a kind means adding a directory and
 * one line here — the composer only ever looks a launcher up by kind id.
 */
export const PARADIGM_LAUNCHERS: Record<ParadigmKindId, ParadigmLauncher> = {
  single: singleLauncher,
  team: teamLauncher,
  compare: compareLauncher,
};

export function paradigmLauncher(kindId: ParadigmKindId): ParadigmLauncher {
  return PARADIGM_LAUNCHERS[kindId];
}

/**
 * What to record on the tasks a launch creates. A kind that names a real instance
 * or carries live params says so itself; the rest get their code-defined instance.
 */
export function paradigmLaunchStamp(
  kindId: ParadigmKindId,
  params: ParadigmLaunchParams
): ParadigmStamp {
  const launcher = PARADIGM_LAUNCHERS[kindId];
  return launcher.stamp?.(params) ?? defaultParadigmStamp(kindId);
}
