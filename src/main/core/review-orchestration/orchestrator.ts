import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  buildPromptInjectionPayload,
  getAgentCommandSubmitDelayMs,
  getAgentCommandSubmitInput,
} from '@shared/agent-command-prefix';
import { reviewReviewerStartedChannel } from '@shared/events/reviewEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import {
  buildImplementerFeedbackPrompt,
  buildReviewFollowupPrompt,
  buildReviewPrompt,
  parseReviewResult,
  REVIEW_MAX_ROUNDS,
} from '@shared/review-protocol';
import type { RuntimeId } from '@shared/runtime-registry';
import { agentSessionRuntimeStore } from '@main/core/conversations/agent-session-runtime';
import { createConversation } from '@main/core/conversations/createConversation';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { db } from '@main/db/client';
import { conversations, reviewOrchestrations } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { waitForImplementerTurnEnd, waitForReviewResult, type SessionKey } from './turn-signal';

const POLL_MS = 1_500;
/** Watchdog per turn — generous; deterministic signals handle the normal case. */
const TURN_TIMEOUT_MS = 30 * 60_000;
/** If the implementer is never seen running this soon, assume it already ran. */
const IMPLEMENTER_GRACE_MS = 20_000;
/**
 * Floor for the gap between writing a (potentially large, bracketed-paste)
 * prompt and writing the submit key. A runtime's registry delay can be 0 (e.g.
 * Claude Code), which races the Enter ahead of the TUI finishing the paste — the
 * prompt then sits unsent in the input box. Mirrors the image-attachment
 * injector's PROMPT_SUBMIT_DELAY_MS, with extra margin since review feedback can
 * be up to 12k chars.
 */
const SUBMIT_DELAY_FLOOR_MS = 300;

type Row = typeof reviewOrchestrations.$inferSelect;

export type StartReviewOrchestrationParams = {
  projectId: string;
  taskId: string;
  implementerConversationId: string;
  requirement: string;
  reviewerRuntime: RuntimeId;
  reviewerSystemPrompt: string;
  reviewerAutoApprove: boolean;
};

class ReviewOrchestrator {
  private active = new Map<string, AbortController>();

  /** Persist a new orchestration and begin driving it. Returns its id. */
  async start(params: StartReviewOrchestrationParams): Promise<string> {
    const id = randomUUID();
    const [row] = await db
      .insert(reviewOrchestrations)
      .values({
        id,
        projectId: params.projectId,
        taskId: params.taskId,
        implementerConversationId: params.implementerConversationId,
        requirement: params.requirement,
        reviewerRuntime: params.reviewerRuntime,
        reviewerSystemPrompt: params.reviewerSystemPrompt,
        reviewerAutoApprove: params.reviewerAutoApprove,
        maxRounds: REVIEW_MAX_ROUNDS,
        round: 1,
        status: 'awaiting_impl',
        createdAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .returning();
    if (row) this.run(row);
    return id;
  }

  /** Resume any orchestration left unfinished by a previous app lifetime. */
  async resumePending(): Promise<void> {
    const pending = await db
      .select()
      .from(reviewOrchestrations)
      .where(
        and(
          isNull(reviewOrchestrations.completedAt),
          inArray(reviewOrchestrations.status, ['awaiting_impl', 'reviewing'])
        )
      );
    if (pending.length === 0) return;
    log.info('ReviewOrchestrator: resuming interrupted orchestrations', { count: pending.length });
    for (const row of pending) this.run(row);
  }

  abort(id: string): void {
    this.active.get(id)?.abort();
  }

  private run(row: Row): void {
    if (this.active.has(row.id)) return;
    const ac = new AbortController();
    this.active.set(row.id, ac);
    void this.loop(row, ac.signal)
      .catch(async (error: unknown) => {
        log.warn('ReviewOrchestrator: orchestration failed', { id: row.id, error: String(error) });
        await this.finish(row.id, 'error', String(error)).catch(() => {});
      })
      .finally(() => {
        this.active.delete(row.id);
      });
  }

  private async loop(row: Row, signal: AbortSignal): Promise<void> {
    const implSession: SessionKey = {
      projectId: row.projectId,
      taskId: row.taskId,
      conversationId: row.implementerConversationId,
    };
    const implSessionId = makePtySessionId(
      row.projectId,
      row.taskId,
      row.implementerConversationId
    );
    const implRuntime = await this.loadRuntime(row.implementerConversationId);
    const reviewerRuntime = row.reviewerRuntime as RuntimeId;

    // The reviewer reuses ONE conversation/session across every round (created on
    // first use, follow-up requests injected thereafter), so it keeps context and
    // the task view shows a single reviewer pane. Persisted on the row so a
    // restart can keep driving the same session.
    let reviewerConversationId = row.currentReviewerConversationId;

    let round = row.round;
    let needImplementerWait = row.status !== 'reviewing';

    while (round <= row.maxRounds) {
      if (signal.aborted) return;

      if (needImplementerWait) {
        const outcome = await waitForImplementerTurnEnd(implSession, {
          signal,
          timeoutMs: TURN_TIMEOUT_MS,
          pollMs: POLL_MS,
          graceMs: IMPLEMENTER_GRACE_MS,
        });
        if (outcome === 'aborted') return;
      }
      needImplementerWait = true;

      const reviewer = await this.ensureReviewerRound(
        row,
        round,
        reviewerConversationId,
        reviewerRuntime
      );
      reviewerConversationId = reviewer.conversationId;
      const reviewerSession: SessionKey = {
        projectId: row.projectId,
        taskId: row.taskId,
        conversationId: reviewerConversationId,
      };
      const review = await waitForReviewResult(
        reviewerSession,
        reviewer.sessionId,
        reviewer.baselineMarkerCount,
        { signal, timeoutMs: TURN_TIMEOUT_MS, pollMs: POLL_MS, graceMs: IMPLEMENTER_GRACE_MS }
      );
      if (review.kind === 'aborted') return;
      if (review.result.passed) {
        await this.finish(row.id, 'passed');
        return;
      }

      round += 1;
      if (round > row.maxRounds) {
        await this.finish(row.id, 'failed');
        return;
      }
      await this.update(row.id, { status: 'awaiting_impl', round });
      await this.sendImplementerFeedback(implSessionId, implSession, implRuntime, {
        reviewFeedback: review.result.feedback,
      });
    }
    await this.finish(row.id, 'failed');
  }

  /**
   * Make sure this round has a reviewer session to wait on. Reuses the live
   * single reviewer session (injecting the next round's request) when it's still
   * running; otherwise — round 1, or the session died across a restart — creates
   * a fresh reviewer conversation and surfaces it in the task view. Returns the
   * session id plus the marker baseline the round's verdict must exceed.
   */
  private async ensureReviewerRound(
    row: Row,
    round: number,
    reviewerConversationId: string | null,
    reviewerRuntime: RuntimeId
  ): Promise<{ conversationId: string; sessionId: string; baselineMarkerCount: number }> {
    const existingSessionId = reviewerConversationId
      ? makePtySessionId(row.projectId, row.taskId, reviewerConversationId)
      : null;
    if (
      reviewerConversationId &&
      existingSessionId &&
      ptySessionRegistry.get(existingSessionId) !== undefined
    ) {
      // Reuse: inject the next round's request and accept only a verdict beyond
      // the markers already sitting in this session's buffer from prior rounds.
      const baselineMarkerCount = parseReviewResult(
        ptySessionRegistry.snapshot(existingSessionId)
      ).markerCount;
      await this.update(row.id, { status: 'reviewing', round });
      await this.sendPrompt(
        existingSessionId,
        { projectId: row.projectId, taskId: row.taskId, conversationId: reviewerConversationId },
        reviewerRuntime,
        buildReviewFollowupPrompt({ round })
      );
      return {
        conversationId: reviewerConversationId,
        sessionId: existingSessionId,
        baselineMarkerCount,
      };
    }

    const newConversationId = randomUUID();
    const sessionId = makePtySessionId(row.projectId, row.taskId, newConversationId);
    await this.update(row.id, {
      status: 'reviewing',
      round,
      currentReviewerConversationId: newConversationId,
    });
    await createConversation({
      id: newConversationId,
      projectId: row.projectId,
      taskId: row.taskId,
      runtime: reviewerRuntime,
      title: 'Review',
      autoApprove: row.reviewerAutoApprove,
      initialPrompt: buildReviewPrompt({
        requirement: row.requirement,
        round,
        systemPrompt: row.reviewerSystemPrompt,
      }),
    });
    // Surface the reviewer side-by-side in the open task view (best-effort; the
    // renderer no-ops if the task isn't currently provisioned).
    events.emit(reviewReviewerStartedChannel, {
      projectId: row.projectId,
      taskId: row.taskId,
      implementerConversationId: row.implementerConversationId,
      reviewerConversationId: newConversationId,
    });
    return { conversationId: newConversationId, sessionId, baselineMarkerCount: 0 };
  }

  private async sendImplementerFeedback(
    sessionId: string,
    session: SessionKey,
    runtime: RuntimeId,
    args: { reviewFeedback: string }
  ): Promise<void> {
    await this.sendPrompt(sessionId, session, runtime, buildImplementerFeedbackPrompt(args));
  }

  /** Inject a prompt into a running agent session and submit it. */
  private async sendPrompt(
    sessionId: string,
    session: SessionKey,
    runtime: RuntimeId,
    prompt: string
  ): Promise<void> {
    const pty = ptySessionRegistry.get(sessionId);
    if (!pty) throw new Error('Target session is not running; cannot deliver prompt.');
    const payload = buildPromptInjectionPayload(prompt);
    if (!payload) return;
    pty.write(payload);
    // Seed working so the next turn-wait observes a running session.
    agentSessionRuntimeStore.setStatus(session, 'working');
    const submitDelay = Math.max(getAgentCommandSubmitDelayMs(runtime), SUBMIT_DELAY_FLOOR_MS);
    await new Promise((resolve) => setTimeout(resolve, submitDelay));
    pty.write(getAgentCommandSubmitInput(runtime));
  }

  private async loadRuntime(conversationId: string): Promise<RuntimeId> {
    const [row] = await db
      .select({ runtime: conversations.runtime })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    return (row?.runtime as RuntimeId) ?? 'claude';
  }

  private async update(
    id: string,
    fields: Partial<Pick<Row, 'status' | 'round' | 'currentReviewerConversationId'>>
  ): Promise<void> {
    await db.update(reviewOrchestrations).set(fields).where(eq(reviewOrchestrations.id, id));
  }

  private async finish(
    id: string,
    status: 'passed' | 'failed' | 'error',
    error?: string
  ): Promise<void> {
    await db
      .update(reviewOrchestrations)
      .set({ status, error: error ?? null, completedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(reviewOrchestrations.id, id));
  }
}

export const reviewOrchestrator = new ReviewOrchestrator();
