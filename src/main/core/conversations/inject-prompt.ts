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
export type PromptInputWriter = (data: string) => boolean | Promise<boolean>;

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
  return injectPromptUsingWriter(session, runtime, prompt, (data) => {
    pty.write(data);
    return true;
  });
}

/**
 * Canonical prompt submission for both direct PTYs and provider-backed/tmux
 * writers. Keep provider suffixes, the paste/Enter delay, and run-state seeding
 * in one place so every input surface submits with identical semantics.
 */
export async function injectPromptUsingWriter(
  session: InjectSession,
  runtime: RuntimeId,
  prompt: string,
  write: PromptInputWriter
): Promise<boolean> {
  const payload = buildPromptInjectionPayload(prompt);
  if (!payload) return true;
  const payloadWrite = write(payload);
  if (payloadWrite === false || (payloadWrite !== true && !(await payloadWrite))) return false;
  const submitSuffix = getAgentCommandSubmitSuffix(runtime, prompt);
  if (submitSuffix) {
    const suffixWrite = write(submitSuffix);
    if (suffixWrite === false || (suffixWrite !== true && !(await suffixWrite))) return false;
  }
  agentSessionRuntimeStore.setStatus(session, 'working');
  const submitDelay = Math.max(getAgentCommandSubmitDelayMs(runtime), SUBMIT_DELAY_FLOOR_MS);
  await new Promise((resolve) => setTimeout(resolve, submitDelay));
  return write(getAgentCommandSubmitInput(runtime));
}
