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
  // A persisted draft is the user's current composer selection. This must
  // outrank the surrounding task/project route when HomeComposer is hosted in
  // the new-task modal; otherwise choosing another directory appears to work
  // and then immediately snaps back to the project behind the modal. `null`
  // is also an explicit projectless choice, so it must suppress that fallback.
  if (draftProjectId !== undefined) {
    return draftProjectId && draftProjectId !== INTERNAL_PROJECT_ID ? draftProjectId : undefined;
  }
  if (navigationProjectId === INTERNAL_PROJECT_ID) return undefined;
  if (navigationProjectId !== undefined) return navigationProjectId;
  return undefined;
}
