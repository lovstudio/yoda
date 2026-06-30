import { createHash } from 'node:crypto';
import type {
  ClaudeSessionPrompt,
  SessionSummary,
  SessionSummaryResult,
  SessionSummaryScope,
  SessionTranscriptMessage,
} from '@shared/conversations';
import { isAgentSessionRunningStatus } from '@shared/events/agentEvents';
import {
  sessionSummaryStreamChannel,
  sessionSummaryTopic,
} from '@shared/events/sessionSummaryEvents';
import type { RuntimeId } from '@shared/runtime-registry';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { agentSessionRuntimeStore } from './agent-session-runtime';
import {
  buildSummaryDraft,
  generateSessionSummary,
  resolveSummaryRuntime,
} from './generateSessionSummary';
import { getClaudeSessionContext } from './getClaudeSessionContext';
import { getCodexSessionContext } from './getCodexSessionContext';
import {
  createSessionSummarySnapshot,
  saveSessionSummarySnapshot,
} from './session-summary-snapshot';
import {
  clearManualSummary,
  getManualSummary,
  getStoredSummary,
  setManualSummary,
  setStoredSummary,
} from './session-summary-store';

/** Number of trailing transcript messages a `recent` summary covers. */
const RECENT_MESSAGE_COUNT = 10;
const SUMMARY_CACHE_MAX = 128;

// Hot path: avoid a DB read when the same content was just summarized. The
// durable copy lives in SQLite (see session-summary-store) so it survives
// restarts; this Map is only a per-process accelerator.
const generatedSummaryCache = new Map<string, SessionSummary>();

/**
 * Resolves a session summary for one scope:
 *   - `global`: the whole session. Prefers the runtime's own compaction
 *     summary (zero cost); otherwise generates from all user prompts.
 *   - `recent`: only the last few user/assistant transcript messages. Always
 *     generated, kept short, and cached by input signature — meant to refresh
 *     after every reply.
 *
 * Generation is skipped while the session is mid-turn (we never spawn a
 * summarization CLI during an active turn). `status` lets the UI explain an
 * absent summary instead of showing a blank state.
 */
export async function getSessionSummary(
  runtimeId: RuntimeId,
  scope: SessionSummaryScope,
  projectId: string,
  taskId: string,
  cwd: string,
  conversationId: string,
  conversationTitle?: string,
  conversationCreatedAt?: string | null,
  /** Manual regenerate: bypass the content cache and re-spawn the CLI. */
  force?: boolean,
  /**
   * Read-only resolve: return whatever summary already exists (manual,
   * compaction, cached, persisted — even stale) but NEVER spawn the CLI.
   * Used by always-visible surfaces like the 基础 grid row.
   */
  peek?: boolean
): Promise<SessionSummaryResult> {
  const startedAt = Date.now();
  const running = isAgentSessionRunningStatus(
    agentSessionRuntimeStore.getStatus({ projectId, taskId, conversationId })
  );

  const contextStartedAt = Date.now();
  const loaded = await loadContext(
    runtimeId,
    cwd,
    conversationId,
    conversationTitle,
    conversationCreatedAt
  );
  const contextDurationMs = Date.now() - contextStartedAt;
  if (loaded === null) {
    log.info('[session-summary] resolved', {
      runtimeId,
      scope,
      status: 'unsupported',
      contextDurationMs,
      totalDurationMs: Date.now() - startedAt,
    });
    return { summary: null, status: 'unsupported' };
  }

  // A user-written summary overrides everything — compaction and generation —
  // until cleared or explicitly regenerated (`force`).
  if (!force) {
    const manual = await getManualSummary(conversationId, scope);
    if (manual) {
      log.info('[session-summary] resolved', {
        runtimeId,
        scope,
        status: 'manual',
        contextDurationMs,
        totalDurationMs: Date.now() - startedAt,
      });
      return { summary: manual, status: 'manual' };
    }
  }

  // Global scope can short-circuit to the runtime's own compaction summary.
  if (scope === 'global' && loaded.summary) {
    log.info('[session-summary] resolved', {
      runtimeId,
      scope,
      status: 'compaction',
      contextDurationMs,
      totalDurationMs: Date.now() - startedAt,
    });
    return { summary: loaded.summary, status: 'compaction' };
  }

  // Provider/model/prompt/context come from the configured summary Agent, NOT
  // the session's runtime — so a dead session runtime never blocks summaries.
  const runtime = await resolveSummaryRuntime(scope, projectId);
  const ctx = runtime.context;
  // Apply the role context BEFORE slicing so `recent` keeps the last N of the
  // INCLUDED roles (e.g. last 10 user messages when assistant is excluded),
  // not 10 mixed messages that mostly get dropped.
  const included = loaded.messages.filter((m) =>
    m.role === 'assistant' ? ctx.assistant : ctx.user
  );
  const messages = scope === 'recent' ? included.slice(-RECENT_MESSAGE_COUNT) : included;
  if (messages.length === 0) {
    log.info('[session-summary] resolved', {
      runtimeId,
      scope,
      status: 'empty',
      contextDurationMs,
      totalDurationMs: Date.now() - startedAt,
    });
    return { summary: null, status: 'empty' };
  }
  if (running && !peek) {
    log.info('[session-summary] resolved', {
      runtimeId,
      scope,
      status: 'running',
      contextDurationMs,
      messageCount: messages.length,
      totalDurationMs: Date.now() - startedAt,
    });
    return { summary: null, status: 'running' };
  }

  const fingerprint = summaryFingerprint(messages);
  // Cache is keyed by the summary runtime (provider, model, language, context)
  // so switching the Agent, language, or context toggles invalidates stale
  // entries.
  const contextKey = `${ctx.user ? 'u' : ''}${ctx.assistant ? 'a' : ''}${ctx.project ? 'p' : ''}`;
  const runtimeKey = `${runtime.runtimeId}:${runtime.model ?? ''}:${runtime.language}:${contextKey}`;
  const cacheKey = `${runtimeKey}:${scope}:${conversationId}:${fingerprint}`;
  // Persisted entry is invalidated by runtime changes too, so switching the
  // summary Agent or language re-generates instead of returning stale text.
  const storedFingerprint = `${runtimeKey}:${fingerprint}`;

  // Content-dedupe: in-process cache, then the durable SQLite copy. Both are
  // keyed by the transcript fingerprint, so an unchanged conversation never
  // re-spawns the CLI (the main slow source for `recent` after every reply).
  // A manual regenerate (`force`) bypasses both and re-spawns.
  if (!force) {
    const cached = generatedSummaryCache.get(cacheKey);
    if (cached) {
      log.info('[session-summary] resolved', {
        runtimeId: runtime.runtimeId,
        scope,
        status: 'cache',
        contextDurationMs,
        messageCount: messages.length,
        totalDurationMs: Date.now() - startedAt,
      });
      return { summary: cached, status: 'generated' };
    }

    const stored = await getStoredSummary(conversationId, scope);
    if (stored && stored.fingerprint === storedFingerprint) {
      setSummaryCache(cacheKey, stored.summary);
      log.info('[session-summary] resolved', {
        runtimeId: runtime.runtimeId,
        scope,
        status: 'persisted',
        contextDurationMs,
        messageCount: messages.length,
        totalDurationMs: Date.now() - startedAt,
      });
      return { summary: stored.summary, status: 'generated' };
    }
    // Peek: a stale persisted summary still beats a blank row; never generate.
    if (peek) {
      if (stored) return { summary: stored.summary, status: 'generated' };
      return { summary: null, status: running ? 'running' : 'empty' };
    }
  }

  const draft = buildSummaryDraft(runtime, cwd, messages, scope);
  if (!draft) return { summary: null, status: 'empty' };
  const snapshotBase = {
    conversationId,
    projectId,
    taskId,
    runtime,
    draft,
  };
  // Debug snapshot (global only — `recent` refreshes every turn and would
  // spam the channel): mirrors the conversation-naming snapshot lifecycle.
  if (scope === 'global') {
    saveSessionSummarySnapshot({ ...snapshotBase, status: 'generating' });
  }

  // SSE: forward the CLI's incremental stdout to the renderer so the summary
  // streams in live instead of appearing only when generation finishes.
  const topic = sessionSummaryTopic(conversationId, scope);
  const generateStartedAt = Date.now();
  const generated = await generateSessionSummary(runtime, cwd, draft, scope, (delta) =>
    events.emit(sessionSummaryStreamChannel, { scope, delta }, topic)
  );
  const generateDurationMs = Date.now() - generateStartedAt;
  if (generated) {
    setSummaryCache(cacheKey, generated);
    await setStoredSummary(conversationId, scope, {
      summary: generated,
      fingerprint: storedFingerprint,
    });
    // An explicit regenerate replaces a manual override — otherwise the fresh
    // result would stay invisible behind it.
    if (force) await clearManualSummary(conversationId, scope);
  }
  if (scope === 'global') {
    saveSessionSummarySnapshot({
      ...snapshotBase,
      status: generated ? 'ready' : 'failed',
      generatedSummary: generated?.text,
      error: generated ? undefined : 'Generation produced no usable summary.',
    });
  }
  events.emit(
    sessionSummaryStreamChannel,
    {
      scope,
      done: true,
      summary: generated,
      status: generated ? 'generated' : 'failed',
    },
    topic
  );
  log.info('[session-summary] resolved', {
    runtimeId: runtime.runtimeId,
    scope,
    status: generated ? 'generated' : 'failed',
    contextDurationMs,
    generateDurationMs,
    messageCount: messages.length,
    totalDurationMs: Date.now() - startedAt,
  });
  return generated
    ? { summary: generated, status: 'generated' }
    : { summary: null, status: 'failed' };
}

async function loadContext(
  runtimeId: RuntimeId,
  cwd: string,
  conversationId: string,
  conversationTitle?: string,
  conversationCreatedAt?: string | null
): Promise<{
  summary: SessionSummary | null;
  prompts: ClaudeSessionPrompt[];
  messages: SessionTranscriptMessage[];
} | null> {
  if (runtimeId === 'claude') {
    const context = await getClaudeSessionContext(cwd, conversationId);
    return {
      summary: context?.summary ?? null,
      prompts: context?.prompts ?? [],
      messages: context?.messages ?? promptsToMessages(context?.prompts ?? []),
    };
  }
  if (runtimeId === 'codex') {
    const context = await getCodexSessionContext(
      cwd,
      conversationId,
      conversationTitle,
      conversationCreatedAt
    );
    return {
      summary: context?.summary ?? null,
      prompts: context?.prompts ?? [],
      messages: context?.messages ?? promptsToMessages(context?.prompts ?? []),
    };
  }
  return null;
}

function promptsToMessages(prompts: ClaudeSessionPrompt[]): SessionTranscriptMessage[] {
  return prompts.map((prompt) => ({ ...prompt, role: 'user' }));
}

/** Content fingerprint of the transcript a summary covers. */
function summaryFingerprint(messages: SessionTranscriptMessage[]): string {
  const hash = createHash('sha256');
  for (const message of messages) {
    hash.update(message.role);
    hash.update('\0');
    hash.update(message.timestamp ?? '');
    hash.update('\0');
    hash.update(message.text);
    hash.update('\0');
  }
  return hash.digest('hex');
}

/**
 * Builds an idle debug snapshot of what a `global` summary run WOULD send —
 * runtime, prompt, context sources — without spawning anything. Mirrors
 * `getConversationNamingPreview` for the summary popover's auto tab.
 */
export async function getSessionSummaryPreview(
  runtimeId: RuntimeId,
  projectId: string,
  taskId: string,
  cwd: string,
  conversationId: string,
  conversationTitle?: string,
  conversationCreatedAt?: string | null
) {
  const base = { conversationId, projectId, taskId };
  try {
    const [loaded, runtime] = await Promise.all([
      loadContext(runtimeId, cwd, conversationId, conversationTitle, conversationCreatedAt),
      resolveSummaryRuntime('global', projectId),
    ]);
    const messages = (loaded?.messages ?? []).filter((m) =>
      m.role === 'assistant' ? runtime.context.assistant : runtime.context.user
    );
    const draft = buildSummaryDraft(runtime, cwd, messages, 'global');
    return createSessionSummarySnapshot({ ...base, status: 'idle', runtime, draft });
  } catch (error) {
    return createSessionSummarySnapshot({
      ...base,
      status: 'failed',
      runtime: null,
      draft: null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Persists (or clears, when `text` is blank) the user-written whole-session
 * summary. A manual summary overrides compaction and generated summaries until
 * the user explicitly regenerates.
 */
export async function setManualSessionSummary(
  conversationId: string,
  text: string
): Promise<SessionSummaryResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    await clearManualSummary(conversationId, 'global');
    return { summary: null, status: 'empty' };
  }
  const summary: SessionSummary = { text: trimmed, timestamp: new Date().toISOString() };
  await setManualSummary(conversationId, 'global', summary);
  return { summary, status: 'manual' };
}

function setSummaryCache(key: string, summary: SessionSummary): void {
  if (!generatedSummaryCache.has(key) && generatedSummaryCache.size >= SUMMARY_CACHE_MAX) {
    const oldest = generatedSummaryCache.keys().next().value;
    if (oldest) generatedSummaryCache.delete(oldest);
  }
  generatedSummaryCache.set(key, summary);
}
