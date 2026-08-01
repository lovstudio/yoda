import { and, eq, sql } from 'drizzle-orm';
import type { Terminal } from '@shared/terminals';
import { db } from '@main/db/client';
import { workspaceTerminals } from '@main/db/schema';

function mapWorkspaceTerminalRow(row: typeof workspaceTerminals.$inferSelect): Terminal {
  return {
    id: row.id,
    projectId: row.projectId,
    taskId: row.scopeId,
    name: row.name,
  };
}

export async function getPersistedWorkspaceTerminals(
  projectId: string,
  scopeId: string
): Promise<Terminal[]> {
  const rows = await db
    .select()
    .from(workspaceTerminals)
    .where(
      and(eq(workspaceTerminals.projectId, projectId), eq(workspaceTerminals.scopeId, scopeId))
    );
  return rows.map(mapWorkspaceTerminalRow);
}

export async function persistWorkspaceTerminal(terminal: Terminal): Promise<Terminal> {
  const [row] = await db
    .insert(workspaceTerminals)
    .values({
      id: terminal.id,
      projectId: terminal.projectId,
      scopeId: terminal.taskId,
      name: terminal.name,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .returning();
  return mapWorkspaceTerminalRow(row);
}

export async function deletePersistedWorkspaceTerminal(
  projectId: string,
  scopeId: string,
  terminalId: string
): Promise<void> {
  await db
    .delete(workspaceTerminals)
    .where(
      and(
        eq(workspaceTerminals.id, terminalId),
        eq(workspaceTerminals.projectId, projectId),
        eq(workspaceTerminals.scopeId, scopeId)
      )
    );
}

export async function renamePersistedWorkspaceTerminal(
  terminalId: string,
  name: string
): Promise<void> {
  await db
    .update(workspaceTerminals)
    .set({ name, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(workspaceTerminals.id, terminalId));
}
