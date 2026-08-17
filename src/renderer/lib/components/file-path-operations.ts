import type { OpenInRequest } from '@shared/openInApps';
import { toast } from '@renderer/lib/hooks/use-toast';
import i18n from '@renderer/lib/i18n';
import { rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import {
  buildFilePathDefaultOpenRequest,
  buildFilePathOpenInRequest,
  type FilePathOpenTarget,
} from './file-path-open';

export async function executeFilePathOpenRequest(request: OpenInRequest): Promise<void> {
  const result = await rpc.app.openIn(request);
  if (!result.success) throw new Error(result.error);
}

/**
 * Open a path and, when it will not open, say why. Callers are all user
 * gestures; a swallowed rejection leaves the click looking like a no-op, which
 * is the one outcome a clickable path must never produce. Extra context lands
 * in the toast's copyable debug info, not in the visible text.
 */
export async function openFilePathReportingFailure(
  request: OpenInRequest,
  debugContext?: Record<string, unknown>
): Promise<void> {
  try {
    await executeFilePathOpenRequest(request);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log.warn('Failed to open path externally', { request, reason });
    toast({
      title: i18n.t('fileActions.openFailed'),
      description: reason || undefined,
      variant: 'destructive',
      debugInfo: { ...debugContext, request, error: reason },
    });
  }
}

export async function openFilePath(
  target: FilePathOpenTarget,
  mode: 'open' | 'reveal' = 'open'
): Promise<void> {
  const request =
    mode === 'reveal'
      ? buildFilePathOpenInRequest('finder', target)
      : buildFilePathDefaultOpenRequest(target);
  await executeFilePathOpenRequest(request);
}
