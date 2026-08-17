import {
  createYodaSessionShareUpload,
  withSessionShareDisplayLevel,
  type YodaSessionShareResponse,
} from '@shared/session-share';
import { lovStudioApiClient } from '@main/core/account/services/lovstudio-api-client';
import { mobileGatewayService } from '@main/core/mobile-gateway/mobile-gateway-service';
import { appSettingsService } from '@main/core/settings/settings-service';
import { getConversationShareUsage } from '@main/core/stats/conversation-usage';
import { attachLocalSessionAssets } from './session-share-assets';

export async function createSessionShare(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<YodaSessionShareResponse> {
  const [{ detail, cwd, embeddedImages }, usage] = await Promise.all([
    mobileGatewayService.getSessionShareSource(projectId, taskId, conversationId),
    // Usage is a nice-to-have on the share page: a runtime with no transcript
    // parser, or a transcript that has been cleaned up, must not block the share.
    getConversationShareUsage(projectId, taskId, conversationId).catch(() => null),
  ]);
  const upload = await attachLocalSessionAssets(
    createYodaSessionShareUpload(detail, usage),
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
