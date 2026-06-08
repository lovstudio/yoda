import { eq } from 'drizzle-orm';
import type { AgentEvent } from '@shared/events/agentEvents';
import { parsePtyId } from '@shared/ptyId';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import type { RawHookRequest } from './hook-server';

function normalizePayload(body: Record<string, unknown>): AgentEvent['payload'] {
  const toolName = (body.tool_name ?? body.toolName) as string | undefined;
  return {
    notificationType: (body.notification_type ??
      body.notificationType) as AgentEvent['payload']['notificationType'],
    lastAssistantMessage: (body.last_assistant_message ?? body.lastAssistantMessage) as
      | string
      | undefined,
    // For interactive-tool waits, surface the tool name so the UI can show
    // "waiting on you: AskUserQuestion".
    title: (body.title as string | undefined) ?? toolName,
    message: body.message as string | undefined,
  };
}

function normalizeEventType(
  providerId: string,
  body: Record<string, unknown>,
  rawType: string
): AgentEvent['type'] {
  if (providerId === 'codex' && body.type === 'agent-turn-complete') {
    return 'stop';
  }
  return rawType as AgentEvent['type'];
}

export async function enrichEvent(raw: RawHookRequest): Promise<AgentEvent | null> {
  const parsed = parsePtyId(raw.ptyId);
  if (!parsed) {
    throw new Error(`Unrecognised ptyId: ${raw.ptyId}`);
  }

  const [convRows] = await db
    .select({ taskId: conversations.taskId, projectId: conversations.projectId })
    .from(conversations)
    .where(eq(conversations.id, parsed.conversationId))
    .limit(1);

  // The conversation may have been deleted between the agent firing the hook and
  // us handling it. Return null so the hook server replies 200 (best-effort) and
  // does not 500 on a benign race.
  if (!convRows) return null;

  const taskId = convRows.taskId;
  const projectId = convRows.projectId;
  const body = raw.body ? JSON.parse(raw.body) : {};
  const payload = normalizePayload(body);

  return {
    type: normalizeEventType(parsed.providerId, body, raw.type),
    ptyId: raw.ptyId,
    providerId: parsed.providerId,
    projectId,
    conversationId: parsed.conversationId,
    taskId,
    timestamp: Date.now(),
    payload,
  };
}
