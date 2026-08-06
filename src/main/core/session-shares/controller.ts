import { createRPCController } from '@shared/ipc/rpc';
import { getLatestAssistantReply } from '@shared/latest-session-reply';
import { mobileGatewayService } from '@main/core/mobile-gateway/mobile-gateway-service';
import { createSessionShare } from './create-session-share';

export const sessionSharesController = createRPCController({
  create: createSessionShare,
  getLatestReply: async (projectId: string, taskId: string, conversationId: string) => {
    const detail = await mobileGatewayService.getSessionDetail(projectId, taskId, conversationId);
    return {
      generatedAt: detail.generatedAt,
      runtimeId: detail.session.runtimeId,
      sessionTitle: detail.session.title,
      reply: getLatestAssistantReply(detail.transcript),
    };
  },
});
