import { and, asc, eq, gt, sql } from 'drizzle-orm';
import {
  emptyAiLogTokens,
  sumAiLogTokens,
  type AiLogTrace,
  type AiLogTraceUnavailableReason,
} from '@shared/ai-log-steps';
import { parseConversationSessionSource } from '@main/core/conversations/conversation-session-source';
import { resolveTaskCwd } from '@main/core/stats/task-cwd';
import { getTranscriptUsageReader } from '@main/core/stats/transcript-readers/registry';
import { db } from '@main/db/client';
import { aiInvocationLogs, conversations, projects, tasks } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { iterateFileLines } from '@main/utils/file-lines';
import { getTranscriptStepParser } from './transcript-steps/registry';
import { StepCollector } from './transcript-steps/step-builder';

/**
 * Claude writes the user row a beat *before* it runs the hook that opens our
 * turn log (~30ms measured), and rows can still land after the hook that closes
 * it. Without slack on both ends a turn loses its own prompt and its last tool
 * result.
 */
const WINDOW_SLACK_MS = 1_500;

/**
 * Reads the provider transcript for what happened *inside* one logged
 * invocation: each API response, its thinking, its tool calls, its cost.
 *
 * Nothing is mirrored into the log table for this — the transcript already is
 * the record (ADR 0009), so the trace resolves from `metadata.conversationId`
 * at read time and works for rows written long before this feature existed.
 *
 * Returns null only when the log id is unknown; every other failure comes back
 * as an explicit `unavailable` reason rather than an empty timeline.
 */
export async function resolveAiLogTrace(logId: string): Promise<AiLogTrace | null> {
  const [row] = await db
    .select({
      purpose: aiInvocationLogs.purpose,
      metadata: aiInvocationLogs.metadata,
      startedAt: aiInvocationLogs.startedAt,
      finishedAt: aiInvocationLogs.finishedAt,
    })
    .from(aiInvocationLogs)
    .where(eq(aiInvocationLogs.id, logId))
    .limit(1);
  if (!row) return null;

  const conversationId = row.metadata?.conversationId;
  if (!conversationId) return unavailable(logId, 'no-conversation');

  const [conversation] = await db
    .select({
      runtime: conversations.runtime,
      config: conversations.config,
      title: conversations.title,
      createdAt: conversations.createdAt,
      task: tasks,
      projectPath: projects.path,
    })
    .from(conversations)
    .innerJoin(tasks, eq(conversations.taskId, tasks.id))
    .innerJoin(projects, eq(conversations.projectId, projects.id))
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!conversation?.runtime) return unavailable(logId, 'no-conversation');

  const parser = getTranscriptStepParser(conversation.runtime);
  const reader = getTranscriptUsageReader(conversation.runtime);
  if (!parser || !reader) return unavailable(logId, 'unsupported-runtime');

  const sessionSource = parseConversationSessionSource(conversation.config);
  const exactSource = sessionSource?.runtimeId === conversation.runtime ? sessionSource : undefined;
  const paths = await reader.resolveTranscriptPaths({
    cwd: await resolveTaskCwd(conversation.task, conversation.projectPath),
    conversationId,
    conversationTitle: conversation.title,
    conversationCreatedAt: conversation.createdAt,
    providerSessionId: exactSource?.sessionId,
    providerStateRoot: exactSource?.stateRoot,
  });
  if (paths.length === 0) return unavailable(logId, 'no-transcript');

  const collector = new StepCollector(
    await resolveWindow({
      purpose: row.purpose,
      conversationId,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
    })
  );

  for (const path of paths) {
    try {
      await parser(iterateFileLines(path), collector);
    } catch (error) {
      log.warn('[ai-log] failed to read transcript for trace', { path, error: String(error) });
    }
  }

  const steps = collector.steps();
  if (steps.length === 0) {
    return { ...unavailable(logId, 'empty-window'), transcriptPath: paths[0] ?? null };
  }
  return {
    logId,
    steps,
    totalSteps: collector.totalSteps(),
    tokens: sumAiLogTokens(steps),
    requestCount: steps.filter((step) => step.tokens !== null).length,
    transcriptPath: paths[0] ?? null,
    unavailable: null,
  };
}

/**
 * The slice of transcript that belongs to this invocation.
 *
 * Its own start is nudged back by the slack: the provider writes the prompt row
 * before it runs the hook that stamps `startedAt`. The end prefers the *next*
 * invocation of the same kind in the same conversation, nudged back the same
 * way — that partitions the transcript with no overlap and no gap, and keeps
 * rows written after the closing hook (the last tool result, a title) inside the
 * turn that produced them.
 */
async function resolveWindow(row: {
  purpose: string;
  conversationId: string;
  startedAt: string;
  finishedAt: string | null;
}): Promise<{ from: number; until: number }> {
  const started = Date.parse(row.startedAt);
  const from = (Number.isFinite(started) ? started : 0) - WINDOW_SLACK_MS;

  const [next] = await db
    .select({ startedAt: aiInvocationLogs.startedAt })
    .from(aiInvocationLogs)
    .where(
      and(
        eq(aiInvocationLogs.purpose, row.purpose),
        gt(aiInvocationLogs.startedAt, row.startedAt),
        sql`json_extract(${aiInvocationLogs.metadata}, '$.conversationId') = ${row.conversationId}`
      )
    )
    .orderBy(asc(aiInvocationLogs.startedAt))
    .limit(1);
  const nextStarted = next ? Date.parse(next.startedAt) : NaN;
  if (Number.isFinite(nextStarted)) return { from, until: nextStarted - WINDOW_SLACK_MS };

  const finished = row.finishedAt ? Date.parse(row.finishedAt) : NaN;
  if (Number.isFinite(finished)) return { from, until: finished + WINDOW_SLACK_MS };
  return { from, until: Date.now() };
}

function unavailable(logId: string, reason: AiLogTraceUnavailableReason): AiLogTrace {
  return {
    logId,
    steps: [],
    totalSteps: 0,
    tokens: emptyAiLogTokens(),
    requestCount: 0,
    transcriptPath: null,
    unavailable: reason,
  };
}
