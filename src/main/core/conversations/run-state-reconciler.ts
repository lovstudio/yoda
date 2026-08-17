import { log } from '@main/lib/logger';
import { agentSessionRuntimeStore } from './agent-session-runtime';
import { reconcileConversationRunState } from './getConversationRuntimeStatuses';

/**
 * Periodic, view-independent run-state reconciliation.
 *
 * Every other thing that can correct a stale `working` / `awaiting-input` is
 * bound to a surface being looked at: the cold derive RPC runs when a task view
 * mounts, the provider tailers and their reconcilers exist only while a session
 * is attached, and the silence reconciler only tracks registered sessions. A
 * session whose settle was missed therefore kept claiming to be running until the
 * user clicked it — and then flipped, which looks exactly like clicking having
 * changed it. Run state must not depend on being observed, so the same
 * derivation runs here on a timer for any running session no live source is
 * watching closely.
 *
 * Cheap by construction: only sessions this process still believes are running
 * are considered, and only after their status has stood untouched for a while
 * (the attached tailers reconcile on a much tighter cadence, so anything they own
 * is normally settled long before this sweep reaches it). Nothing is inferred
 * from absence here — the derivation itself decides, and it asks the provider's
 * truth source and the tmux pane rather than assuming.
 */
const SWEEP_INTERVAL_MS = 15_000;
const MIN_SETTLE_MS = 10_000;

class RunStateReconcilerService {
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;

  initialize(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Exposed for tests and for callers that want an immediate pass. */
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      for (const session of agentSessionRuntimeStore.listRunningSessions({
        settledForMs: MIN_SETTLE_MS,
      })) {
        await reconcileConversationRunState(session).catch((error: unknown) => {
          log.warn('Run-state reconcile failed', {
            conversationId: session.conversationId,
            error: String(error),
          });
        });
      }
    } finally {
      this.sweeping = false;
    }
  }
}

export const runStateReconcilerService = new RunStateReconcilerService();
