import type { OpenInRequest } from '@shared/openInApps';
import { rpc } from '@renderer/lib/ipc';
import {
  buildFilePathDefaultOpenRequest,
  buildFilePathOpenInRequest,
  type FilePathOpenTarget,
} from './file-path-open';

export async function executeFilePathOpenRequest(request: OpenInRequest): Promise<void> {
  const result = await rpc.app.openIn(request);
  if (!result.success) throw new Error(result.error);
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
