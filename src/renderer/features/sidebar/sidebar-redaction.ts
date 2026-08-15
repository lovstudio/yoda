/**
 * Privacy-mode redaction treatment, shared by every sidebar surface that shows
 * a project or task name. Light blur (shape stays, text does not) rather than a
 * solid block, so the list is still navigable during a screen share.
 *
 * Which rows get it is decided by `sidebarStore.isProjectRedacted(projectId)` —
 * privacy mode minus the project allowlist.
 */
export const SIDEBAR_REDACTED_CLASS = 'blur-[2px] opacity-80';

/**
 * Privacy mode still has to be navigable: the project name under the pointer
 * clears, so a row can be identified — and its menu reached — without turning
 * the whole mode off. Task titles and branches keep the blur; they are the
 * sensitive half. Requires an ancestor carrying `group/row`.
 */
export const SIDEBAR_REDACTED_HOVER_REVEAL_CLASS =
  'group-hover/row:blur-none group-hover/row:opacity-100';
