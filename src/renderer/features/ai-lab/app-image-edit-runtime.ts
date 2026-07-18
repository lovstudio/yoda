import type { AiLabImageEditResult } from '@shared/ai-lab-bridge';

export type AppImageEditStage = 'preparing' | 'uploading' | 'generating' | 'completed' | 'failed';

export type AppImageEditSnapshot = {
  status: 'idle' | 'running' | 'succeeded' | 'failed';
  stage: AppImageEditStage | null;
  progress: number;
  startedAt: string | null;
  error: string | null;
  historyId: string | null;
};

const IDLE_SNAPSHOT: AppImageEditSnapshot = Object.freeze({
  status: 'idle',
  stage: null,
  progress: 0,
  startedAt: null,
  error: null,
  historyId: null,
});

type Listener = () => void;

class AppImageEditRuntime {
  private readonly snapshots = new Map<string, AppImageEditSnapshot>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly active = new Map<string, Promise<AiLabImageEditResult>>();

  getSnapshot = (appId: string): AppImageEditSnapshot => this.snapshots.get(appId) ?? IDLE_SNAPSHOT;

  subscribe = (appId: string, listener: Listener): (() => void) => {
    const listeners = this.listeners.get(appId) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(appId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(appId);
    };
  };

  run(appId: string, task: () => Promise<AiLabImageEditResult>): Promise<AiLabImageEditResult> {
    const current = this.active.get(appId);
    if (current) return current;

    const startedAt = new Date().toISOString();
    this.set(appId, {
      status: 'running',
      stage: 'preparing',
      progress: 6,
      startedAt,
      error: null,
      historyId: null,
    });

    const startedMs = Date.now();
    const timer = setInterval(() => {
      const snapshot = this.getSnapshot(appId);
      if (snapshot.status !== 'running') return;
      const elapsed = Date.now() - startedMs;
      const stage = elapsed < 1_200 ? 'uploading' : 'generating';
      const progress =
        stage === 'uploading' ? 16 : Math.min(92, 24 + Math.floor(elapsed / 2_000) * 4);
      if (stage !== snapshot.stage || progress !== snapshot.progress) {
        this.set(appId, { ...snapshot, stage, progress });
      }
    }, 500);

    const promise = Promise.resolve()
      .then(task)
      .then((result) => {
        this.set(appId, {
          status: 'succeeded',
          stage: 'completed',
          progress: 100,
          startedAt,
          error: null,
          historyId: result.historyId ?? null,
        });
        return result;
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.set(appId, {
          status: 'failed',
          stage: 'failed',
          progress: 0,
          startedAt,
          error: message,
          historyId: null,
        });
        throw error;
      })
      .finally(() => {
        clearInterval(timer);
        this.active.delete(appId);
      });

    this.active.set(appId, promise);
    return promise;
  }

  reset(appId: string): void {
    if (this.active.has(appId)) return;
    this.snapshots.delete(appId);
    this.emit(appId);
  }

  private set(appId: string, snapshot: AppImageEditSnapshot): void {
    this.snapshots.set(appId, snapshot);
    this.emit(appId);
  }

  private emit(appId: string): void {
    for (const listener of this.listeners.get(appId) ?? []) listener();
  }
}

export const appImageEditRuntime = new AppImageEditRuntime();
