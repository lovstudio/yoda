import { parseAiLabWindowTargetSearch, type AiLabWindowTarget } from '@shared/ai-lab-window';

/** AI Lab app windows cold-start with a persisted app id encoded in the URL. */
const initialTarget: AiLabWindowTarget | null =
  typeof window === 'undefined' ? null : parseAiLabWindowTargetSearch(window.location.search);

/** True when this renderer was launched as a detached AI Lab app window. */
export const isAiLabWindowLaunch = initialTarget !== null;

export function getAiLabWindowLaunchTarget(): AiLabWindowTarget | null {
  return initialTarget;
}
