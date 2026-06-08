import type { AgentProviderId } from '@shared/agent-provider-registry';
import type {
  ClaudeSessionPrompt,
  SessionSummary,
  SessionSummaryResult,
} from '@shared/conversations';
import { isAgentSessionRunningStatus } from '@shared/events/agentEvents';
import { log } from '@main/lib/logger';
import { agentSessionRuntimeStore } from './agent-session-runtime';
import { generateSessionSummary } from './generateSessionSummary';
import { getClaudeSessionContext } from './getClaudeSessionContext';
import { getCodexSessionContext } from './getCodexSessionContext';

/**
 * Resolves a session summary with this priority:
 *   1. the compaction summary the runtime already wrote into the transcript
 *      (zero cost — preferred)
 *   2. an on-demand summary generated from the session's user prompts
 *      (only when no compaction summary exists AND the session is idle, so we
 *      never spawn a summarization CLI in the middle of an active turn)
 *
 * `status` lets the UI explain why there is no summary yet (running / no
 * prompts / generation failed) instead of a blank "no summary".
 */
export async function getSessionSummary(
  providerId: AgentProviderId,
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

  const prompts = await loadPrompts(
    providerId,
    cwd,
    conversationId,
    conversationTitle,
    conversationCreatedAt
  );
  if (prompts === null) return { summary: null, status: 'unsupported' };
  if (prompts.summary) return { summary: prompts.summary, status: 'compaction' };
  if (running) return { summary: null, status: 'running' };
  if (prompts.prompts.length === 0) return { summary: null, status: 'empty' };

  const generated = await generateSessionSummary(providerId, cwd, prompts.prompts);
  log.info('[session-summary] generated', { providerId, ok: generated !== null });
  return generated
    ? { summary: generated, status: 'generated' }
    : { summary: null, status: 'failed' };
}

async function loadPrompts(
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
