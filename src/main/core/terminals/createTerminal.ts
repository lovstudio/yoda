import { and, eq, sql } from 'drizzle-orm';
import { makePtySessionId } from '@shared/ptySessionId';
import type { CreateTerminalParams, Terminal } from '@shared/terminals';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { db } from '@main/db/client';
import { terminals } from '@main/db/schema';
import { telemetryService } from '@main/lib/telemetry';
import { resolveTask } from '../projects/utils';
import { mapTerminalRowToTerminal } from './core';

export async function createTerminal(params: CreateTerminalParams): Promise<Terminal> {
  const { id: terminalId, initialSize = { cols: 80, rows: 24 } } = params;
  const sessionId = makePtySessionId(params.projectId, params.taskId, terminalId);
  const registrationEpoch = ptySessionRegistry.beginRegistration(sessionId);
  const registrationIsCurrent = () =>
    ptySessionRegistry.isRegistrationCurrent(sessionId, registrationEpoch);
  try {
    if (!registrationIsCurrent()) {
      throw new Error('Terminal creation was cancelled before persistence.');
    }
    const [row] = await db
      .insert(terminals)
      .values({
        id: terminalId,
        projectId: params.projectId,
        taskId: params.taskId,
        name: params.name,
        ssh: 0,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .returning();

    if (!registrationIsCurrent()) {
      await db
        .delete(terminals)
        .where(
          and(
            eq(terminals.id, terminalId),
            eq(terminals.projectId, params.projectId),
            eq(terminals.taskId, params.taskId)
          )
        );
      throw new Error('Terminal creation was cancelled during persistence.');
    }
    const task = resolveTask(params.projectId, params.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    await task.terminals.spawnTerminal(mapTerminalRowToTerminal(row), initialSize);
    telemetryService.capture('terminal_created', {
      terminal_id: terminalId,
      project_id: params.projectId,
      task_id: params.taskId,
    });

    return mapTerminalRowToTerminal(row);
  } finally {
    ptySessionRegistry.cancelRegistration(sessionId, registrationEpoch);
  }
}
