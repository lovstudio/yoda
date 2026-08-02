import { and, eq, sql } from 'drizzle-orm';
import { makePtySessionId } from '@shared/ptySessionId';
import type { CreateTerminalParams, Terminal } from '@shared/terminals';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { db } from '@main/db/client';
import { tasks, terminals } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { resolveTask, withTimeout } from '../projects/utils';
import { mapTerminalRowToTerminal } from './core';
import {
  MAX_PERSISTED_TERMINALS_PER_TASK,
  TerminalRecordOverflowError,
} from './getTerminalsForTask';

const CREATE_BURST_WINDOW_MS = 10_000;
const CREATE_BURST_LIMIT = 32;
export const TERMINAL_ROLLBACK_KILL_TIMEOUT_MS = 2_000;

const createBursts = new Map<string, { startedAt: number; count: number }>();
const inFlightCreates = new Map<string, { fingerprint: string; promise: Promise<Terminal> }>();
let lastCreateBurstSweepAt = 0;

function sweepExpiredCreateBursts(now: number): void {
  if (now >= lastCreateBurstSweepAt && now - lastCreateBurstSweepAt < CREATE_BURST_WINDOW_MS) {
    return;
  }
  lastCreateBurstSweepAt = now;
  for (const [key, burst] of createBursts) {
    if (now - burst.startedAt >= CREATE_BURST_WINDOW_MS || now < burst.startedAt) {
      createBursts.delete(key);
    }
  }
}

function assertCreateBurstAvailable(projectId: string, taskId: string): void {
  const key = `${projectId}\0${taskId}`;
  const now = Date.now();
  sweepExpiredCreateBursts(now);
  const current = createBursts.get(key);
  if (!current || now - current.startedAt >= CREATE_BURST_WINDOW_MS) {
    createBursts.set(key, { startedAt: now, count: 1 });
    return;
  }
  if (current.count >= CREATE_BURST_LIMIT) {
    throw new Error('Terminal creation rate limit exceeded. Wait before trying again.');
  }
  current.count += 1;
}

function createFingerprint(params: CreateTerminalParams): string {
  const initialSize = params.initialSize ?? { cols: 80, rows: 24 };
  return JSON.stringify({
    projectId: params.projectId,
    taskId: params.taskId,
    id: params.id,
    name: params.name,
    initialSize,
  });
}

function persistTerminalWithinLimit(params: CreateTerminalParams) {
  return db.transaction((tx) => {
    const taskRow = tx
      .select({ archivedAt: tasks.archivedAt, archiveRequestedAt: tasks.archiveRequestedAt })
      .from(tasks)
      .where(and(eq(tasks.id, params.taskId), eq(tasks.projectId, params.projectId)))
      .limit(1)
      .get();
    if (!taskRow || taskRow.archivedAt || taskRow.archiveRequestedAt) {
      throw new Error('Cannot create a terminal for a missing or archived task.');
    }

    const persisted = tx
      .select({ id: terminals.id })
      .from(terminals)
      .where(and(eq(terminals.projectId, params.projectId), eq(terminals.taskId, params.taskId)))
      .limit(MAX_PERSISTED_TERMINALS_PER_TASK)
      .all();
    if (persisted.length >= MAX_PERSISTED_TERMINALS_PER_TASK) {
      throw new TerminalRecordOverflowError(params.taskId, persisted.length);
    }

    const row = tx
      .insert(terminals)
      .values({
        id: params.id,
        projectId: params.projectId,
        taskId: params.taskId,
        name: params.name,
        ssh: 0,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .returning()
      .get();
    if (!row) throw new Error('Failed to persist terminal.');
    return row;
  });
}

async function createTerminalOnce(params: CreateTerminalParams): Promise<Terminal> {
  const { id: terminalId, initialSize = { cols: 80, rows: 24 } } = params;
  const task = resolveTask(params.projectId, params.taskId);
  if (!task) {
    throw new Error('Task not found');
  }
  // Keep the cheap in-memory circuit breaker ahead of every database read.
  assertCreateBurstAvailable(params.projectId, params.taskId);

  const sessionId = makePtySessionId(params.projectId, params.taskId, terminalId);
  const registrationEpoch = ptySessionRegistry.beginRegistration(sessionId);
  const registrationIsCurrent = () =>
    ptySessionRegistry.isRegistrationCurrent(sessionId, registrationEpoch);
  let persisted = false;
  let spawned = false;
  try {
    if (!registrationIsCurrent()) {
      throw new Error('Terminal creation was cancelled before persistence.');
    }
    const row = persistTerminalWithinLimit(params);
    persisted = true;

    if (!registrationIsCurrent()) {
      throw new Error('Terminal creation was cancelled during persistence.');
    }

    await task.terminals.spawnTerminal(mapTerminalRowToTerminal(row), initialSize);
    spawned = true;
    telemetryService.capture('terminal_created', {
      terminal_id: terminalId,
      project_id: params.projectId,
      task_id: params.taskId,
    });

    return mapTerminalRowToTerminal(row);
  } catch (error) {
    if (persisted && !spawned) {
      const killCleanup = withTimeout(
        Promise.resolve().then(() => task.terminals.killTerminal(terminalId)),
        TERMINAL_ROLLBACK_KILL_TIMEOUT_MS
      );
      const deleteCleanup = (async () => {
        await db
          .delete(terminals)
          .where(
            and(
              eq(terminals.id, terminalId),
              eq(terminals.projectId, params.projectId),
              eq(terminals.taskId, params.taskId)
            )
          );
      })();
      const [killResult, deleteResult] = await Promise.allSettled([killCleanup, deleteCleanup]);
      if (killResult.status === 'rejected') {
        log.warn('createTerminal: failed to clean up partial terminal spawn', {
          terminalId,
          error: String(killResult.reason),
        });
      }
      if (deleteResult.status === 'rejected') {
        log.error('createTerminal: failed to roll back persisted terminal', {
          terminalId,
          error: String(deleteResult.reason),
        });
      }
    }
    throw error;
  } finally {
    ptySessionRegistry.cancelRegistration(sessionId, registrationEpoch);
  }
}

export function createTerminal(params: CreateTerminalParams): Promise<Terminal> {
  const sessionId = makePtySessionId(params.projectId, params.taskId, params.id);
  const fingerprint = createFingerprint(params);
  const existing = inFlightCreates.get(sessionId);
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      return Promise.reject(
        new Error('A conflicting terminal creation is already in progress for this terminal ID.')
      );
    }
    return existing.promise;
  }

  const promise = createTerminalOnce(params);
  const entry = { fingerprint, promise };
  inFlightCreates.set(sessionId, entry);
  void promise.then(
    () => {
      if (inFlightCreates.get(sessionId) === entry) inFlightCreates.delete(sessionId);
    },
    () => {
      if (inFlightCreates.get(sessionId) === entry) inFlightCreates.delete(sessionId);
    }
  );
  return promise;
}
