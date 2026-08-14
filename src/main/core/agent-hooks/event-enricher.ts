import { eq, like } from 'drizzle-orm';
import type { AgentEvent } from '@shared/events/agentEvents';
import { makePtyId, parsePtyId } from '@shared/ptyId';
import { parseConversationSessionSource } from '@main/core/conversations/conversation-session-source';
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
    // UserPromptSubmit forwards the agent CLI's stdin JSON, which carries the
    // submitted prompt text — recorded per turn in the AI invocation log.
    prompt: body.prompt as string | undefined,
  };
}

function normalizeEventType(
  runtimeId: string,
  body: Record<string, unknown>,
  rawType: string
): AgentEvent['type'] {
  if (runtimeId === 'codex' && body.type === 'agent-turn-complete') {
    return 'stop';
  }
  return rawType as AgentEvent['type'];
}

/**
 * Resolve which conversation actually fired this hook.
 *
 * `X-Yoda-Pty-Id` comes from `$YODA_PTY_ID`, which for Claude is injected into
 * `.claude/settings.local.json` `env` — a single PROJECT-WIDE file. Every Claude
 * session in the same project therefore reports whichever conversation started
 * last, so hooks from older sessions land on the wrong conversation (a `waiting`
 * Notification from session B flips session A to "awaiting input" while A is
 * still working, and A's own Stop never clears it).
 *
 * Claude stamps every hook payload with its own `session_id`, which is
 * per-process and cannot be cross-wired. Prefer it, and fall back to the ptyId
 * only when the payload carries no usable session id (non-Claude clients).
 */
async function resolveConversationId(
  ptyConversationId: string,
  body: Record<string, unknown>
): Promise<string | null> {
  const sessionId = (body.session_id ?? body.sessionId) as string | undefined;
  if (!sessionId || sessionId === ptyConversationId) return ptyConversationId;

  // Fast path: Yoda spawns Claude with `--session-id <conversationId>`, so the
  // agent session id is normally the conversation id itself.
  const [direct] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.id, sessionId))
    .limit(1);
  if (direct) return direct.id;

  // Adopted/imported sessions keep the provider's own id in `sessionSource`.
  const candidates = await db
    .select({ id: conversations.id, config: conversations.config })
    .from(conversations)
    .where(like(conversations.config, `%${sessionId}%`));
  const matched = candidates.find(
    (row) => parseConversationSessionSource(row.config)?.sessionId === sessionId
  );
  return matched?.id ?? null;
}

export async function enrichEvent(raw: RawHookRequest): Promise<AgentEvent | null> {
  const parsed = parsePtyId(raw.ptyId);
  if (!parsed) {
    throw new Error(`Unrecognised ptyId: ${raw.ptyId}`);
  }

  const body = raw.body ? JSON.parse(raw.body) : {};
  const conversationId = await resolveConversationId(parsed.conversationId, body);
  // The firing session has no conversation of its own (deleted mid-flight, or a
  // stray CLI outside Yoda). Attributing it to the ptyId's conversation would
  // corrupt an unrelated session's run state, so drop it.
  if (!conversationId) return null;

  const [convRows] = await db
    .select({ taskId: conversations.taskId, projectId: conversations.projectId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  // The conversation may have been deleted between the agent firing the hook and
  // us handling it. Return null so the hook server replies 200 (best-effort) and
  // does not 500 on a benign race.
  if (!convRows) return null;

  const taskId = convRows.taskId;
  const projectId = convRows.projectId;
  const payload = normalizePayload(body);

  return {
    type: normalizeEventType(parsed.runtimeId, body, raw.type),
    ptyId: makePtyId(parsed.runtimeId, conversationId),
    runtimeId: parsed.runtimeId,
    projectId,
    conversationId,
    taskId,
    timestamp: Date.now(),
    payload,
  };
}
