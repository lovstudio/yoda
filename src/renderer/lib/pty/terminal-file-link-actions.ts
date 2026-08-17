import { buildFilePathDefaultOpenRequest } from '@renderer/lib/components/file-path-open';
import { openFilePathReportingFailure } from '@renderer/lib/components/file-path-operations';
import { toast } from '@renderer/lib/hooks/use-toast';
import i18n from '@renderer/lib/i18n';
import { log } from '@renderer/utils/logger';
import type { TerminalFileLinkOptions, TerminalFileLinkTarget } from './terminal-file-links';

/**
 * Acting on a clicked terminal link. Kept apart from terminal-file-link-open,
 * whose resolution logic stays free of IPC and toasts.
 */

/** Keep terminal surfaces lightweight; load the global file-tab lifecycle only on demand. */
export async function openTerminalGlobalFileInYoda(filePath: string): Promise<void> {
  try {
    const { openProjectFileTab } = await import(
      '@renderer/features/project-file/project-file-navigation'
    );
    openProjectFileTab(null, filePath);
  } catch (error) {
    reportTerminalFileLinkFailure(error instanceof Error ? error.message : String(error), {
      path: filePath,
      stage: 'open-in-yoda',
    });
  }
}

/**
 * The tail every terminal surface shares once it decides not to open the target
 * itself: hand it to the OS, or say why nothing can open it. A path the parser
 * could not resolve to disk is the common case — the terminal printed it
 * relative to some other directory — and it used to fail as a dead click.
 */
export async function openTerminalFileLinkExternally(
  target: TerminalFileLinkTarget,
  options: Pick<TerminalFileLinkOptions, 'sshConnectionId'>
): Promise<void> {
  if (!target.absolutePath) {
    reportTerminalFileLinkFailure(i18n.t('fileActions.openFailedUnresolved'), {
      text: target.originalText,
      filePath: target.filePath,
      sshConnectionId: options.sshConnectionId,
      stage: 'resolve',
    });
    return;
  }
  await openFilePathReportingFailure(
    buildFilePathDefaultOpenRequest({
      absolutePath: target.absolutePath,
      kind: target.isDirectory ? 'directory' : 'file',
      sshConnectionId: options.sshConnectionId,
      line: target.line,
      column: target.column,
    }),
    { text: target.originalText }
  );
}

/** Single voice for "this link did not open", with the details behind the copy action. */
export function reportTerminalFileLinkFailure(
  reason: string,
  debugContext: Record<string, unknown>
): void {
  log.warn('Failed to open terminal file link', { reason, ...debugContext });
  toast({
    title: i18n.t('fileActions.openFailed'),
    description: reason || undefined,
    variant: 'destructive',
    debugInfo: { ...debugContext, error: reason },
  });
}
