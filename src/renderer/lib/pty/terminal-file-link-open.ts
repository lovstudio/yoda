import type { OpenInRequest } from '@shared/openInApps';
import type { TerminalSmartPathOpenMode } from '@shared/terminal-settings';
import { buildFilePathDefaultOpenRequest } from '@renderer/lib/components/file-path-open';
import type { TerminalFileLinkOptions, TerminalFileLinkTarget } from './terminal-file-links';

/**
 * Resolve the path Yoda's file views can open for a terminal link.
 *
 * Workspace-relative paths work for both local and SSH-backed task views.
 * Local absolute files use Yoda's global file tab, whose lifecycle authorizes
 * external paths before reading them. Remote absolute paths outside the
 * workspace still need an external opener.
 */
export type TerminalFileLinkInternalDestination = {
  path: string;
  placement: 'workspace' | 'global';
};

export function getTerminalFileLinkInternalDestination(
  target: TerminalFileLinkTarget,
  options: Pick<TerminalFileLinkOptions, 'sshConnectionId'>
): TerminalFileLinkInternalDestination | null {
  if (target.isDirectory) return null;
  if (target.filePath) return { path: target.filePath, placement: 'workspace' };
  if (!options.sshConnectionId && target.absolutePath) {
    return { path: target.absolutePath, placement: 'global' };
  }
  return null;
}

/** Keep terminal surfaces lightweight; load the global file-tab lifecycle only on demand. */
export async function openTerminalGlobalFileInYoda(filePath: string): Promise<void> {
  const { openProjectFileTab } = await import(
    '@renderer/features/project-file/project-file-navigation'
  );
  openProjectFileTab(null, filePath);
}

/**
 * Returns an OS-level request only when the user prefers external smart-path
 * opening. Without an absolute path, the current surface keeps ownership.
 */
export function buildTerminalFileLinkExternalOpenRequest(
  mode: TerminalSmartPathOpenMode,
  target: TerminalFileLinkTarget,
  options: TerminalFileLinkOptions
): OpenInRequest | null {
  if (mode !== 'external' || !target.absolutePath) return null;

  return buildFilePathDefaultOpenRequest({
    absolutePath: target.absolutePath,
    kind: target.isDirectory ? 'directory' : 'file',
    sshConnectionId: options.sshConnectionId,
    line: target.line,
    column: target.column,
  });
}
