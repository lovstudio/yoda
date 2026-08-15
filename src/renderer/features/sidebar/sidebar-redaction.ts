/**
 * Privacy-mode redaction treatment, shared by every sidebar surface that shows
 * a project or task name. Light blur (shape stays, text does not) rather than a
 * solid block, so the list is still navigable during a screen share.
 *
 * Which rows get it is decided by `sidebarStore.isProjectRedacted(projectId)` —
 * privacy mode minus the project allowlist.
 */
export const SIDEBAR_REDACTED_CLASS = 'blur-[2px] opacity-80';
