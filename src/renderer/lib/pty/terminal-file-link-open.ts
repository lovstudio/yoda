import type { OpenInRequest } from '@shared/openInApps';
import type { TerminalSmartPathOpenMode } from '@shared/terminal-settings';
import { buildFilePathDefaultOpenRequest } from '@renderer/lib/components/file-path-open';
import type { TerminalFileLinkOptions, TerminalFileLinkTarget } from './terminal-file-links';

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
