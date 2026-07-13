import type { OpenInAppId, OpenInRequest } from '@shared/openInApps';

export type FilePathOpenTarget = {
  absolutePath: string;
  kind?: 'file' | 'directory';
  sshConnectionId?: string | null;
  line?: number;
  column?: number;
};

export function buildFilePathOpenInRequest(
  app: OpenInAppId,
  target: FilePathOpenTarget
): OpenInRequest {
  const isDirectory = target.kind === 'directory';
  const isRemote = target.sshConnectionId != null;
  const supportsLocation = !isDirectory && !isRemote;
  const hasLine = supportsLocation && target.line !== undefined;
  return {
    app,
    path: target.absolutePath,
    reveal: app === 'finder' && !isDirectory,
    isRemote,
    sshConnectionId: target.sshConnectionId ?? null,
    ...(hasLine ? { line: target.line } : {}),
    ...(hasLine && target.column !== undefined ? { column: target.column } : {}),
  };
}

/**
 * Preserve ordinary OS-default opening for plain files, but route source
 * locations through VS Code because shell.openPath cannot express line/column.
 */
export function buildFilePathDefaultOpenRequest(target: FilePathOpenTarget): OpenInRequest {
  const isRemote = target.sshConnectionId != null;
  const hasLocation = target.kind !== 'directory' && target.line !== undefined;
  const app: OpenInAppId = isRemote ? 'terminal' : hasLocation ? 'vscode' : 'finder';
  return {
    ...buildFilePathOpenInRequest(app, target),
    // The generic open action opens the target itself; Finder's explicit app
    // entry remains the separate "reveal in Finder" action for local files.
    reveal: false,
  };
}
