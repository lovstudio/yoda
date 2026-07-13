import { INTERNAL_PROJECT_ID } from '@shared/projects';

interface ResolveHomeProjectIdArgs {
  lockedProjectId?: string;
  homeProjectId?: string;
  navigationProjectId?: string;
  draftProjectId?: string | null;
}

/**
 * The internal Drafts project is the persistence layer for projectless tasks,
 * not a user-selectable project. Treat navigation from that project as an
 * explicit projectless selection instead of falling through to a stale draft.
 */
export function resolveHomeProjectId({
  lockedProjectId,
  homeProjectId,
  navigationProjectId,
  draftProjectId,
}: ResolveHomeProjectIdArgs): string | undefined {
  if (lockedProjectId !== undefined) return lockedProjectId;
  if (homeProjectId === INTERNAL_PROJECT_ID) return undefined;
  if (homeProjectId !== undefined) return homeProjectId;
  if (navigationProjectId === INTERNAL_PROJECT_ID) return undefined;
  if (navigationProjectId !== undefined) return navigationProjectId;
  return draftProjectId && draftProjectId !== INTERNAL_PROJECT_ID ? draftProjectId : undefined;
}
