import { getAppById, type OpenInRequest } from '@shared/openInApps';
import type { TerminalLinkFileHandler } from '@shared/terminal-settings';
import {
  buildFilePathDefaultOpenRequest,
  buildFilePathOpenInRequest,
} from '@renderer/lib/components/file-path-open';
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

/**
 * Turn the resolved handler into an OS-level open request, or null when the
 * current surface should keep ownership and open the target inside Yoda.
 */
export function buildTerminalFileLinkOpenRequest(
  handler: TerminalLinkFileHandler,
  target: TerminalFileLinkTarget,
  options: Pick<TerminalFileLinkOptions, 'sshConnectionId'>
): OpenInRequest | null {
  // A relative path means nothing to an external app, so the surface that
  // resolved it against its workspace root stays in charge.
  if (handler === 'yoda' || !target.absolutePath) return null;

  const openTarget = {
    absolutePath: target.absolutePath,
    kind: target.isDirectory ? ('directory' as const) : ('file' as const),
    sshConnectionId: options.sshConnectionId,
    line: target.line,
    column: target.column,
  };

  if (handler === 'system') return buildFilePathDefaultOpenRequest(openTarget);
  // Handing a remote path to an app that cannot reach the remote host only
  // produces a failed request; fall back to opening it inside Yoda.
  if (options.sshConnectionId != null && getAppById(handler)?.supportsRemote !== true) return null;
  return buildFilePathOpenInRequest(handler, openTarget);
}
