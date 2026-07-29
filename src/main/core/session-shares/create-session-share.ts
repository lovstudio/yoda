import { createYodaSessionShareUpload, type YodaSessionShareResponse } from '@shared/session-share';
import { lovStudioApiClient } from '@main/core/account/services/lovstudio-api-client';
import { mobileGatewayService } from '@main/core/mobile-gateway/mobile-gateway-service';

export async function createSessionShare(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<YodaSessionShareResponse> {
  const detail = await mobileGatewayService.getSessionDetail(projectId, taskId, conversationId);
  const upload = createYodaSessionShareUpload(detail);
  if (upload.blocks.length === 0) {
    throw new Error('This session has no shareable chat history yet.');
  }

  return lovStudioApiClient.request<YodaSessionShareResponse>('/api/yoda/session-shares', {
    method: 'POST',
    body: JSON.stringify(upload),
  });
}
