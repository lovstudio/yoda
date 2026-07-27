import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AgentSessionRuntimeStatus } from '@shared/events/agentEvents';
import { parsePtySessionId } from '@shared/ptySessionId';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { projectManager } from '@main/core/projects/project-manager';
import { decodeTmuxSessionName, listTmuxSessionMarkers } from '@main/core/pty/tmux-session-name';
import { db } from '@main/db/client';
import { conversations, projects, tasks } from '@main/db/schema';
import { agentSessionRuntimeStore, type AgentSessionKey } from './agent-session-runtime';
import { parseConversationSessionSource } from './conversation-session-source';
import { getConversationRunStatus } from './getConversationRuntimeStatuses';

export type ActiveRuntimeStatusEntry = AgentSessionKey & {
  status: Exclude<AgentSessionRuntimeStatus, 'idle'>;
};

export type ActiveRuntimeStatusSnapshot = {
  /** Projects whose runtime entries are fully represented by this snapshot. */
  coveredProjectIds: string[];
  entries: ActiveRuntimeStatusEntry[];
};

type RuntimeCandidate = AgentSessionKey & {
  cwd: string;
};

type ActiveConversationRow = {
  projectId: string;
  taskId: string;
  conversationId: string;
  runtime: string | null;
  title: string | null;
  createdAt: string | null;
  config: string | null;
};

const DB_QUERY_CHUNK_SIZE = 250;

function sessionKey(session: AgentSessionKey): string {
  return `${session.projectId}\0${session.taskId}\0${session.conversationId}`;
}

/**
 * Hydrate only sessions that have a live system marker.
 *
 * A previous implementation parsed every transcript at startup, which made
 * launch cost proportional to all historical conversations. This path instead
 * combines the main-process live cache with the isolated Yoda tmux server, then
 * derives transcript state only for surviving tmux sessions. No task provider,
 * terminal, or renderer task view is opened.
 *
 * With no project id, the snapshot covers every active local project. Passing a
 * project id scans that already-mounted project's execution context, which also
 * supports SSH projects after their normal startup mount completes.
 */
export async function getActiveRuntimeStatuses(
  projectId?: string
): Promise<ActiveRuntimeStatusSnapshot> {
  const scope = await resolveScope(projectId);
  if (!scope) return { coveredProjectIds: [], entries: [] };

  try {
    const coveredProjectIds = scope.projectIds;
    const coveredProjects = new Set(coveredProjectIds);
    const memoryEntries = agentSessionRuntimeStore
      .getAllStatuses()
      .filter((entry) => coveredProjects.has(entry.projectId));
    const memoryByKey = new Map(memoryEntries.map((entry) => [sessionKey(entry), entry]));

    const candidates = new Map<string, RuntimeCandidate>();
    for (const entry of memoryEntries) {
      candidates.set(sessionKey(entry), { ...entry, cwd: '' });
    }

    const markers = await listTmuxSessionMarkers(scope.ctx);
    for (const marker of markers) {
      const encodedSessionId = decodeTmuxSessionName(marker.sessionName);
      if (!encodedSessionId) continue;
      const parsed = parsePtySessionId(encodedSessionId);
      if (!parsed || !coveredProjects.has(parsed.projectId)) continue;
      const candidate: RuntimeCandidate = {
        projectId: parsed.projectId,
        taskId: parsed.scopeId,
        conversationId: parsed.leafId,
        cwd: marker.cwd,
      };
      const key = sessionKey(candidate);
      const existing = candidates.get(key);
      candidates.set(key, existing?.cwd ? existing : candidate);
    }

    const activeRows = await loadActiveConversationRows([...candidates.values()]);
    const entries: ActiveRuntimeStatusEntry[] = [];
    for (const row of activeRows) {
      const key = sessionKey(row);
      const cached = memoryByKey.get(key)?.status;
      const candidate = candidates.get(key);
      const status =
        cached ??
        (await getConversationRunStatus({
          projectId: row.projectId,
          taskId: row.taskId,
          conversationId: row.conversationId,
          provider: row.runtime ?? '',
          cwd: candidate?.cwd ?? '',
          title: row.title,
          createdAt: row.createdAt,
          sessionSource: parseConversationSessionSource(row.config),
        }));
      if (status !== 'idle') {
        entries.push({
          projectId: row.projectId,
          taskId: row.taskId,
          conversationId: row.conversationId,
          status,
        });
      }
    }

    return { coveredProjectIds, entries };
  } finally {
    scope.dispose?.();
  }
}

async function resolveScope(projectId: string | undefined): Promise<
  | {
      ctx: IExecutionContext;
      projectIds: string[];
      dispose?: () => void;
    }
  | undefined
> {
  if (projectId) {
    const provider = projectManager.getProject(projectId);
    if (!provider) return undefined;
    return { ctx: provider.ctx, projectIds: [projectId] };
  }

  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(isNull(projects.archivedAt), eq(projects.workspaceProvider, 'local')));
  const ctx = new LocalExecutionContext();
  return {
    ctx,
    projectIds: rows.map((row) => row.id),
    dispose: () => ctx.dispose(),
  };
}

async function loadActiveConversationRows(
  candidates: RuntimeCandidate[]
): Promise<ActiveConversationRow[]> {
  if (candidates.length === 0) return [];

  const candidateById = new Map(
    candidates.map((candidate) => [candidate.conversationId, candidate])
  );
  const conversationIds = [...candidateById.keys()];
  const rows: ActiveConversationRow[] = [];

  for (let offset = 0; offset < conversationIds.length; offset += DB_QUERY_CHUNK_SIZE) {
    const ids = conversationIds.slice(offset, offset + DB_QUERY_CHUNK_SIZE);
    const chunk = await db
      .select({
        projectId: conversations.projectId,
        taskId: conversations.taskId,
        conversationId: conversations.id,
        runtime: conversations.runtime,
        title: conversations.title,
        createdAt: conversations.createdAt,
        config: conversations.config,
      })
      .from(conversations)
      .innerJoin(tasks, eq(conversations.taskId, tasks.id))
      .innerJoin(projects, eq(conversations.projectId, projects.id))
      .where(
        and(
          inArray(conversations.id, ids),
          isNull(conversations.archivedAt),
          isNull(tasks.archivedAt),
          isNull(projects.archivedAt)
        )
      );
    rows.push(
      ...chunk.filter((row) => {
        const candidate = candidateById.get(row.conversationId);
        return candidate?.projectId === row.projectId && candidate.taskId === row.taskId;
      })
    );
  }

  return rows;
}
