import {
  buildPromptInjectionPayload,
  getAgentCommandSubmitDelayMs,
  getAgentCommandSubmitInput,
  getAgentCommandSubmitSuffix,
} from '@shared/agent-command-prefix';
import type { RuntimeId } from '@shared/runtime-registry';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { agentSessionRuntimeStore } from './agent-session-runtime';

/**
 * Floor for the gap between writing a (possibly large, bracketed-paste) prompt
 * and the submit key. A runtime's registry delay can be 0 (Claude Code), which
 * races the Enter ahead of the TUI finishing the paste — the prompt then sits
 * unsent. Shared by review orchestration and the Team Room conductor.
 */
export const SUBMIT_DELAY_FLOOR_MS = 300;

export type InjectSession = { projectId: string; taskId: string; conversationId: string };

/**
 * Inject a prompt into a running agent PTY and submit it. Seeds the session
 * 'working' so the next turn-wait observes it running. Returns false when the
 * session isn't running (caller decides whether to throw, resume, or skip).
 */
export async function injectPrompt(
  sessionId: string,
  session: InjectSession,
  runtime: RuntimeId,
  prompt: string
): Promise<boolean> {
  const pty = ptySessionRegistry.get(sessionId);
  if (!pty) return false;
  const payload = buildPromptInjectionPayload(prompt);
  if (!payload) return true;
  pty.write(payload);
  const submitSuffix = getAgentCommandSubmitSuffix(runtime, prompt);
  if (submitSuffix) pty.write(submitSuffix);
  agentSessionRuntimeStore.setStatus(session, 'working');
  const submitDelay = Math.max(getAgentCommandSubmitDelayMs(runtime), SUBMIT_DELAY_FLOOR_MS);
  await new Promise((resolve) => setTimeout(resolve, submitDelay));
  pty.write(getAgentCommandSubmitInput(runtime));
  return true;
}
