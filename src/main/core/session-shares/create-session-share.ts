import type { AgentReplyDisplayLevel } from '@shared/agent-reply-display';
import { createYodaSessionShareUpload, type YodaSessionShareResponse } from '@shared/session-share';
import { lovStudioApiClient } from '@main/core/account/services/lovstudio-api-client';
import { mobileGatewayService } from '@main/core/mobile-gateway/mobile-gateway-service';
import { attachLocalSessionAssets } from './session-share-assets';

export async function createSessionShare(
  projectId: string,
  taskId: string,
  conversationId: string,
  replyDisplayLevel: AgentReplyDisplayLevel
): Promise<YodaSessionShareResponse> {
  const { detail, cwd, embeddedImages } = await mobileGatewayService.getSessionShareSource(
    projectId,
    taskId,
    conversationId
  );
  const upload = await attachLocalSessionAssets(
    createYodaSessionShareUpload(detail, replyDisplayLevel),
    cwd,
    embeddedImages
  );
  if (upload.blocks.length === 0) {
    throw new Error('This session has no shareable chat history yet.');
  }

  return lovStudioApiClient.request<YodaSessionShareResponse>(
    '/api/yoda/session-shares',
    {
      method: 'POST',
      body: JSON.stringify(upload),
    },
    { timeoutMs: 60_000 }
  );
}
