import {
  createYodaSessionShareUpload,
  withSessionShareDisplayLevel,
  type YodaSessionShareResponse,
} from '@shared/session-share';
import { lovStudioApiClient } from '@main/core/account/services/lovstudio-api-client';
import { mobileGatewayService } from '@main/core/mobile-gateway/mobile-gateway-service';
import { appSettingsService } from '@main/core/settings/settings-service';
import { attachLocalSessionAssets } from './session-share-assets';

export async function createSessionShare(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<YodaSessionShareResponse> {
  const { detail, cwd, embeddedImages } = await mobileGatewayService.getSessionShareSource(
    projectId,
    taskId,
    conversationId
  );
  const upload = await attachLocalSessionAssets(
    createYodaSessionShareUpload(detail),
    cwd,
    embeddedImages
  );
  if (upload.blocks.length === 0) {
    throw new Error('This session has no shareable chat history yet.');
  }

  const created = await lovStudioApiClient.request<YodaSessionShareResponse>(
    '/api/yoda/session-shares',
    {
      method: 'POST',
      body: JSON.stringify(upload),
    },
    { timeoutMs: 60_000 }
  );
  const { sessionShareDisplayLevel } = await appSettingsService.get('interface');
  return { ...created, url: withSessionShareDisplayLevel(created.url, sessionShareDisplayLevel) };
}
