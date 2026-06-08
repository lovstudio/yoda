import { eq } from 'drizzle-orm';
import { hookExecChannel } from '@shared/events/agentEvents';
import { parsePtyId } from '@shared/ptyId';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import type { RawHookRequest } from '../hook-server';

export async function enrichHookExecEvent(raw: RawHookRequest): Promise<void> {
  const parsed = parsePtyId(raw.ptyId);
  if (!parsed) return;

  let body: Record<string, unknown>;
  try {
    body = raw.body ? (JSON.parse(raw.body) as Record<string, unknown>) : {};
  } catch (err) {
    log.warn('enrichHookExecEvent: bad body', { error: String(err) });
    return;
  }

  const [conv] = await db
    .select({ taskId: conversations.taskId, projectId: conversations.projectId })
    .from(conversations)
    .where(eq(conversations.id, parsed.conversationId))
    .limit(1);
  if (!conv) return;

  const exitRaw = body.exitCode;
  const exitCode =
    typeof exitRaw === 'number'
      ? exitRaw
      : typeof exitRaw === 'string' && exitRaw.trim() !== ''
        ? Number(exitRaw)
        : undefined;

  events.emit(
    hookExecChannel,
    {
      projectId: conv.projectId,
      taskId: conv.taskId,
      conversationId: parsed.conversationId,
      providerId: parsed.providerId,
      hookId: typeof body.hookId === 'string' ? body.hookId : '',
      hookEvent: typeof body.hookEvent === 'string' ? body.hookEvent : '',
      command: typeof body.command === 'string' ? body.command : '',
      exitCode: Number.isNaN(exitCode) ? undefined : exitCode,
      output: typeof body.output === 'string' ? body.output : undefined,
      timestamp: Date.now(),
    },
    conv.taskId
  );
}
