import type { AgentProviderId } from '@shared/agent-provider-registry';
import type {
  ClaudeSessionPrompt,
  SessionSummary,
  SessionSummaryResult,
  SessionSummaryScope,
} from '@shared/conversations';
import { isAgentSessionRunningStatus } from '@shared/events/agentEvents';
import { log } from '@main/lib/logger';
import { agentSessionRuntimeStore } from './agent-session-runtime';
import { generateSessionSummary } from './generateSessionSummary';
import { getClaudeSessionContext } from './getClaudeSessionContext';
import { getCodexSessionContext } from './getCodexSessionContext';

/** Number of trailing user prompts a `recent` summary covers. */
const RECENT_PROMPT_COUNT = 4;

/**
 * Resolves a session summary for one scope:
 *   - `global`: the whole session. Prefers the runtime's own compaction
 *     summary (zero cost); otherwise generates from all user prompts.
 *   - `recent`: only the last few user prompts. Always generated, kept short
 *     and cheap — meant to refresh after every reply.
 *
 * Generation is skipped while the session is mid-turn (we never spawn a
 * summarization CLI during an active turn). `status` lets the UI explain an
 * absent summary instead of showing a blank state.
 */
export async function getSessionSummary(
  providerId: AgentProviderId,
  scope: SessionSummaryScope,
  projectId: string,
  taskId: string,
  cwd: string,
  conversationId: string,
  conversationTitle?: string,
  conversationCreatedAt?: string | null
): Promise<SessionSummaryResult> {
  const running = isAgentSessionRunningStatus(
    agentSessionRuntimeStore.getStatus({ projectId, taskId, conversationId })
  );

  const loaded = await loadContext(
    providerId,
    cwd,
    conversationId,
    conversationTitle,
    conversationCreatedAt
  );
  if (loaded === null) return { summary: null, status: 'unsupported' };

  // Global scope can short-circuit to the runtime's own compaction summary.
  if (scope === 'global' && loaded.summary) {
    return { summary: loaded.summary, status: 'compaction' };
  }

  const prompts = scope === 'recent' ? loaded.prompts.slice(-RECENT_PROMPT_COUNT) : loaded.prompts;
  if (prompts.length === 0) return { summary: null, status: 'empty' };
  if (running) return { summary: null, status: 'running' };

  const generated = await generateSessionSummary(providerId, cwd, prompts, scope);
  log.info('[session-summary] generated', { providerId, scope, ok: generated !== null });
  return generated
    ? { summary: generated, status: 'generated' }
    : { summary: null, status: 'failed' };
}

async function loadContext(
  providerId: AgentProviderId,
  cwd: string,
  conversationId: string,
  conversationTitle?: string,
  conversationCreatedAt?: string | null
): Promise<{ summary: SessionSummary | null; prompts: ClaudeSessionPrompt[] } | null> {
  if (providerId === 'claude') {
    const context = await getClaudeSessionContext(cwd, conversationId);
    return { summary: context?.summary ?? null, prompts: context?.prompts ?? [] };
  }
  if (providerId === 'codex') {
    const context = await getCodexSessionContext(
      cwd,
      conversationId,
      conversationTitle,
      conversationCreatedAt
    );
    return { summary: context?.summary ?? null, prompts: context?.prompts ?? [] };
  }
  return null;
}
