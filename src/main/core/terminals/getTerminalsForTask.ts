import { and, eq } from 'drizzle-orm';
import { type Terminal } from '@shared/terminals';
import { db } from '@main/db/client';
import { terminals } from '@main/db/schema';
import { mapTerminalRowToTerminal } from './core';

export const MAX_PERSISTED_TERMINALS_PER_TASK = 128;

export class TerminalRecordOverflowError extends Error {
  readonly code = 'terminal_record_overflow';

  constructor(
    readonly taskId: string,
    readonly count: number
  ) {
    super(
      count > MAX_PERSISTED_TERMINALS_PER_TASK
        ? `Task ${taskId} has more than ${MAX_PERSISTED_TERMINALS_PER_TASK} persisted terminals; refusing to materialize an unsafe result.`
        : `Task ${taskId} already has the maximum ${MAX_PERSISTED_TERMINALS_PER_TASK} persisted terminals.`
    );
    this.name = 'TerminalRecordOverflowError';
  }
}

export async function getTerminalsForTask(projectId: string, taskId: string): Promise<Terminal[]> {
  const rows = await db
    .select()
    .from(terminals)
    .where(and(eq(terminals.projectId, projectId), eq(terminals.taskId, taskId)))
    .limit(MAX_PERSISTED_TERMINALS_PER_TASK + 1);
  if (rows.length > MAX_PERSISTED_TERMINALS_PER_TASK) {
    throw new TerminalRecordOverflowError(taskId, rows.length);
  }
  return rows.map(mapTerminalRowToTerminal);
}
