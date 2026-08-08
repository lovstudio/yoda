import {
  buildPromptInjectionPayload,
  getAgentCommandSubmitDelayMs,
  getAgentCommandSubmitInput,
  getAgentCommandSubmitSuffix,
} from '@shared/agent-command-prefix';
import type { RuntimeId } from '@shared/runtime-registry';
import type { Pty } from '@main/core/pty/pty';

const TUI_READY_QUIET_MS = 700;
const TUI_READY_TIMEOUT_MS = 10_000;
const SUBMIT_DELAY_FLOOR_MS = 300;

/**
 * Deliver runtime-native setup input only after the interactive TUI has booted.
 * This is used for stateful commands such as Codex `/plan`, where passing the
 * task as a CLI argument would submit it in Default collaboration mode first.
 */
export async function injectTuiStartupInput({
  pty,
  runtimeId,
  input,
}: {
  pty: Pty;
  runtimeId: RuntimeId;
  input: string;
}): Promise<boolean> {
  const ready = await waitForTuiReady(pty);
  if (!ready) return false;

  const payload = buildPromptInjectionPayload(input);
  if (!payload) return true;
  pty.write(payload);

  const submitSuffix = getAgentCommandSubmitSuffix(runtimeId, input);
  if (submitSuffix) pty.write(submitSuffix);
  await sleep(Math.max(getAgentCommandSubmitDelayMs(runtimeId), SUBMIT_DELAY_FLOOR_MS));
  pty.write(getAgentCommandSubmitInput(runtimeId));
  return true;
}

function waitForTuiReady(pty: Pty): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    function finish(ready: boolean) {
      if (done) return;
      done = true;
      if (quietTimer) clearTimeout(quietTimer);
      clearTimeout(timeout);
      resolve(ready);
    }
    const timeout = setTimeout(() => finish(true), TUI_READY_TIMEOUT_MS);
    timeout.unref?.();

    pty.onData(() => {
      if (done) return;
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => finish(true), TUI_READY_QUIET_MS);
      quietTimer.unref?.();
    });
    pty.onExit(() => finish(false));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
