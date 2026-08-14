import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  sessionOpenPerformanceChannel,
  type SessionOpenPerformanceContext,
  type SessionOpenPerformanceEvent,
  type SessionOpenPerformanceStage,
} from '@shared/session-open-performance';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';

export type SessionOpenPerformanceDetails = Record<
  string,
  boolean | number | string | null | undefined
>;

type TraceIdentity = {
  projectId: string;
  taskId: string;
  conversationId: string;
  sessionId: string;
};

type TraceDependencies = {
  monotonicNow: () => number;
  epochNow: () => number;
  write: (message: string, payload: SessionOpenPerformanceDetails) => void;
  operationId: () => string;
};

const defaultDependencies: TraceDependencies = {
  monotonicNow: () => performance.now(),
  epochNow: () => Date.now(),
  write: (message, payload) => {
    log.info(message, payload);
    events.emit(sessionOpenPerformanceChannel, payload as SessionOpenPerformanceEvent);
  },
  operationId: () => `session-open-${randomUUID()}`,
};

function roundMs(value: number): number {
  return Math.round(Math.max(0, value) * 10) / 10;
}

function errorKind(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

export class SessionOpenPerformanceTrace {
  private readonly startedAt: number;
  private readonly onceStages = new Set<SessionOpenPerformanceStage>();

  constructor(
    private readonly context: SessionOpenPerformanceContext,
    private readonly identity: TraceIdentity,
    private readonly dependencies: TraceDependencies = defaultDependencies,
    private readonly operationId = dependencies.operationId()
  ) {
    this.startedAt = dependencies.monotonicNow();
  }

  startSpan(): number {
    return this.dependencies.monotonicNow();
  }

  mark(stage: SessionOpenPerformanceStage, details: SessionOpenPerformanceDetails = {}): void {
    const now = this.dependencies.monotonicNow();
    this.dependencies.write('[session-open-main]', {
      context_id: this.context.contextId,
      operation_id: this.operationId,
      projectId: this.identity.projectId,
      taskId: this.identity.taskId,
      conversationId: this.identity.conversationId,
      sessionId: this.identity.sessionId,
      stage,
      elapsedMs: roundMs(now - this.startedAt),
      sinceClickMs: roundMs(this.dependencies.epochNow() - this.context.clickAtEpochMs),
      ...details,
    });
  }

  markOnce(stage: SessionOpenPerformanceStage, details: SessionOpenPerformanceDetails = {}): void {
    if (this.onceStages.has(stage)) return;
    this.onceStages.add(stage);
    this.mark(stage, details);
  }

  endSpan(
    stage: SessionOpenPerformanceStage,
    startedAt: number,
    details: SessionOpenPerformanceDetails = {}
  ): void {
    this.mark(stage, {
      durationMs: roundMs(this.dependencies.monotonicNow() - startedAt),
      ...details,
    });
  }

  async measure<T>(
    stage: SessionOpenPerformanceStage,
    operation: () => Promise<T>,
    details?: SessionOpenPerformanceDetails | ((result: T) => SessionOpenPerformanceDetails)
  ): Promise<T> {
    const startedAt = this.startSpan();
    try {
      const result = await operation();
      this.endSpan(stage, startedAt, {
        success: true,
        ...(typeof details === 'function' ? details(result) : details),
      });
      return result;
    } catch (error) {
      this.endSpan(stage, startedAt, {
        success: false,
        errorKind: errorKind(error),
        ...(typeof details === 'function' ? {} : details),
      });
      throw error;
    }
  }

  measureSync<T>(
    stage: SessionOpenPerformanceStage,
    operation: () => T,
    details?: SessionOpenPerformanceDetails | ((result: T) => SessionOpenPerformanceDetails)
  ): T {
    const startedAt = this.startSpan();
    try {
      const result = operation();
      this.endSpan(stage, startedAt, {
        success: true,
        ...(typeof details === 'function' ? details(result) : details),
      });
      return result;
    } catch (error) {
      this.endSpan(stage, startedAt, {
        success: false,
        errorKind: errorKind(error),
        ...(typeof details === 'function' ? {} : details),
      });
      throw error;
    }
  }
}

export function createSessionOpenPerformanceTrace(
  context: SessionOpenPerformanceContext | undefined,
  identity: TraceIdentity,
  dependencies?: TraceDependencies
): SessionOpenPerformanceTrace | undefined {
  if (!context) return undefined;
  return new SessionOpenPerformanceTrace(context, identity, dependencies);
}
