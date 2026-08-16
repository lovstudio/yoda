import { createRPCController } from '@shared/ipc/rpc';
import { getLatestAssistantReply } from '@shared/latest-session-reply';
import { getRuntime, isValidRuntimeId } from '@shared/runtime-registry';
import { mobileGatewayService } from '@main/core/mobile-gateway/mobile-gateway-service';
import { createSessionShare } from './create-session-share';

export const sessionSharesController = createRPCController({
  create: createSessionShare,
  getLatestReply: async (projectId: string, taskId: string, conversationId: string) => {
    const detail = await mobileGatewayService.getSessionDetail(projectId, taskId, conversationId);
    // The gateway speaks the wire protocol, where a client id is an opaque
    // string. Resolve the display name here so the renderer never has to
    // re-narrow it against the desktop registry.
    const runtimeId = detail.session.runtimeId;
    return {
      generatedAt: detail.generatedAt,
      runtimeId,
      runtimeName: (isValidRuntimeId(runtimeId) ? getRuntime(runtimeId)?.name : null) ?? runtimeId,
      sessionTitle: detail.session.title,
      reply: getLatestAssistantReply(detail.transcript),
    };
  },
});
