import { basenameFromAnyPath } from '@shared/path-name';

/** Joins a project root and repo-relative path without assuming the host OS. */
export function joinProjectPath(basePath: string, relativePath: string): string {
  const normalizedRelativePath = relativePath.replace(/^\/+/, '');
  if (!normalizedRelativePath) return basePath;
  const separator = basePath.includes('\\') && !basePath.includes('/') ? '\\' : '/';
  return `${basePath.replace(/[\\/]+$/, '')}${separator}${normalizedRelativePath.replace(
    /\//g,
    separator
  )}`;
}

export function replaceProjectPathLeaf(projectPath: string, leaf: string): string {
  const normalizedPath = projectPath.replace(/[\\/]+$/, '');
  const separatorIndex = Math.max(
    normalizedPath.lastIndexOf('/'),
    normalizedPath.lastIndexOf('\\')
  );
  if (separatorIndex < 0) return leaf;
  return `${normalizedPath.slice(0, separatorIndex + 1)}${leaf}`;
}

/**
 * Returns the destination path when a displayed project name should also rename
 * a matching path directory. An alias is required because an empty alias falls
 * back to the stored project name rather than naming a new directory.
 */
export function getProjectPathForNameRename(
  currentName: string,
  currentPath: string,
  nextName: string | null
): string | undefined {
  const trimmedName = nextName?.trim() ?? '';
  if (!trimmedName || basenameFromAnyPath(currentPath) !== currentName) return undefined;
  return replaceProjectPathLeaf(currentPath, trimmedName);
}
