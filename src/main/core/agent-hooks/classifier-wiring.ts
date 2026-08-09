import { BrowserWindow } from 'electron';
import { agentEventChannel, type AgentEvent } from '@shared/events/agentEvents';
import { makePtyId } from '@shared/ptyId';
import { type RuntimeId } from '@shared/runtime-registry';
import { agentSessionRuntimeStore } from '@main/core/conversations/agent-session-runtime';
import { type Pty } from '@main/core/pty/pty';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { createClassifier } from './classifiers';
import { stripAnsi, type ClassificationResult } from './classifiers/base';
import { maybeShowNotification } from './notification';

// Approval prompts are already fully rendered when the PTY goes quiet. Keep
// the fallback status responsive without waiting several seconds after the
// final prompt line.
const IDLE_THRESHOLD_MS = 400;
const COOLDOWN_MS = 10_000;
const EDGE_RESET_THRESHOLD = 20;

// ── Helpers ──────────────────────────────────────────────────────────

function isSubstantiveOutput(chunk: string): boolean {
  return stripAnsi(chunk).trim().length > 0;
}

function classificationKey(result: ClassificationResult): string | undefined {
  if (!result) return undefined;
  return result.type === 'notification' ? `${result.type}:${result.notificationType}` : result.type;
}

function isAppFocused(): boolean {
  return BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isFocused());
}

// ── Emission guard ───────────────────────────────────────────────────

function createEmissionGuard() {
  let lastEmittedKey: string | undefined;
  let lastEmitTime = 0;
  let chunksSinceLastEmit = 0;

  return {
    onVisibleChunk() {
      chunksSinceLastEmit++;
      if (chunksSinceLastEmit > EDGE_RESET_THRESHOLD) {
        lastEmittedKey = undefined;
      }
    },

    shouldEmit(result: ClassificationResult): boolean {
      const key = classificationKey(result);

      if (!key) {
        lastEmittedKey = undefined;
        return false;
      }

      if (key === lastEmittedKey) return false;

      const now = Date.now();
      if (now - lastEmitTime < COOLDOWN_MS) return false;

      lastEmittedKey = key;
      lastEmitTime = now;
      chunksSinceLastEmit = 0;
      return true;
    },
  };
}

export function wireAgentClassifier({
  pty,
  runtimeId,
  projectId,
  taskId,
  conversationId,
}: {
  pty: Pty;
  runtimeId: RuntimeId;
  projectId: string;
  taskId: string;
  conversationId: string;
}): void {
  const classifier = createClassifier(runtimeId);
  const ptyId = makePtyId(runtimeId, conversationId);
  const guard = createEmissionGuard();

  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  pty.onExit(() => {
    if (idleTimer) clearTimeout(idleTimer);
    classifier.reset();
  });

  pty.onData((chunk) => {
    classifier.classify(chunk);

    if (!isSubstantiveOutput(chunk)) return;

    guard.onVisibleChunk();

    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      let result: ClassificationResult = undefined;
      try {
        result = classifier.classify('');
        if (!guard.shouldEmit(result)) return;

        const event: AgentEvent = {
          type: result!.type,
          source: 'classifier',
          ptyId,
          runtimeId,
          conversationId,
          taskId,
          projectId,
          timestamp: Date.now(),
          payload: {
            message: result!.message,
            notificationType:
              result!.type === 'notification' ? result!.notificationType : undefined,
          },
        };
        const appFocused = isAppFocused();
        agentSessionRuntimeStore.setFromAgentEvent(event);
        void maybeShowNotification(event, appFocused);
        events.emit(agentEventChannel, { event, appFocused });
      } catch (err) {
        log.warn('wireAgentClassifier: idle check failed', { error: String(err) });
      } finally {
        // A confirmed prompt must not remain in the sliding buffer. Otherwise
        // the next idle tick can classify the same old TUI text again after
        // the user has already continued the session.
        if (result) classifier.reset();
      }
    }, IDLE_THRESHOLD_MS);
  });
}
