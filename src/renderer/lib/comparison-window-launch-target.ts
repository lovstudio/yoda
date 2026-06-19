import {
  parseComparisonWindowTargetSearch,
  type ComparisonWindowTarget,
} from '@shared/comparison-window';

/**
 * A comparison window cold-starts with its target already encoded in the URL
 * (there is no warm-pool variant, unlike task windows), so the target is read
 * once at module load and never changes for the lifetime of the window.
 */
const initialTarget: ComparisonWindowTarget | null =
  typeof window === 'undefined' ? null : parseComparisonWindowTargetSearch(window.location.search);

/** True when this renderer was launched as a detached comparison window. */
export const isComparisonWindowLaunch = initialTarget !== null;

export function getComparisonWindowLaunchTarget(): ComparisonWindowTarget | null {
  return initialTarget;
}
