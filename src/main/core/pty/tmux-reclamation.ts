import { inArray } from 'drizzle-orm';
import type {
  TmuxCleanupResult,
  TmuxReclamationBlocker,
  TmuxReclamationItem,
  TmuxReclamationSnapshot,
  TmuxSessionOwnerKind,
} from '@shared/app-resource';
import { makePtySessionId, parsePtySessionId } from '@shared/ptySessionId';
import {
  resolveColdConversationReclamationStatuses,
  type ColdConversationReclamationCandidate,
  type ColdConversationReclamationStatus,
} from '@main/core/conversations/cold-conversation-reclamation';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { db } from '@main/db/client';
import { conversations, projects, tasks, terminals, workspaceTerminals } from '@main/db/schema';
import { ptySessionRegistry, type PtySessionDiagnostics } from './pty-session-registry';
import {
  decodeTmuxSessionName,
  killTmuxSessionIfMarkerMatchesStrict,
  listTmuxSessionMarkersStrict,
  type ConditionalTmuxKillResult,
  type TmuxSessionMarker,
} from './tmux-session-name';

export const TMUX_RECLAMATION_GRACE_PERIOD_MS = 30 * 60_000;
export const TMUX_RECLAMATION_CLEANUP_CONCURRENCY = 4;

export type TmuxPersistentOwner = {
  kind: Exclude<TmuxSessionOwnerKind, 'unknown'>;
  id: string;
  state: 'active' | 'archived';
  /** Durable provider verdict for a surviving, unmounted conversation process. */
  coldStatus?: ColdConversationReclamationStatus;
  /** Corrupt/ambiguous ownership must never be bypassed by a provider idle verdict. */
  protected?: boolean;
};

export type TmuxReclamationDependencies = {
  listMarkers: (ctx: IExecutionContext) => Promise<TmuxSessionMarker[]>;
  loadOwners: (markers?: readonly TmuxSessionMarker[]) => Promise<Map<string, TmuxPersistentOwner>>;
  getDiagnostics: (sessionId: string) => PtySessionDiagnostics | null;
  killSession: (
    ctx: IExecutionContext,
    marker: TmuxSessionMarker
  ) => Promise<ConditionalTmuxKillResult>;
};

type SnapshotOptions = {
  ctx?: IExecutionContext;
  nowMs?: number;
  gracePeriodMs?: number;
  dependencies?: Partial<TmuxReclamationDependencies>;
};

type CleanupOptions = SnapshotOptions;

function resolveDependencies(
  overrides?: Partial<TmuxReclamationDependencies>
): TmuxReclamationDependencies {
  return {
    listMarkers: listTmuxSessionMarkersStrict,
    loadOwners: loadTmuxPersistentOwners,
    getDiagnostics: (sessionId) => ptySessionRegistry.getDiagnostics(sessionId),
    killSession: killTmuxSessionIfMarkerMatchesStrict,
    ...overrides,
  };
}

function ownerState(
  projectArchivedAt: string | null | undefined,
  taskArchivedAt?: string | null,
  leafArchivedAt?: string | null
): 'active' | 'archived' {
  return projectArchivedAt || taskArchivedAt || leafArchivedAt ? 'archived' : 'active';
}

function setOwner(
  owners: Map<string, TmuxPersistentOwner>,
  sessionId: string,
  owner: TmuxPersistentOwner
): void {
  const existing = owners.get(sessionId);
  if (existing && (existing.kind !== owner.kind || existing.id !== owner.id)) {
    existing.protected = true;
    owner.protected = true;
  }
  // Corrupt/legacy duplicate identities fail closed when any live owner exists.
  if (!existing || (existing.state === 'archived' && owner.state === 'active')) {
    owners.set(sessionId, owner);
  }
}

export async function loadTmuxPersistentOwners(
  markers?: readonly TmuxSessionMarker[]
): Promise<Map<string, TmuxPersistentOwner>> {
  const [projectRows, taskRows, conversationRows, terminalRows, workspaceTerminalRows] =
    await Promise.all([
      db.select({ id: projects.id, archivedAt: projects.archivedAt }).from(projects),
      db
        .select({
          id: tasks.id,
          projectId: tasks.projectId,
          archivedAt: tasks.archivedAt,
        })
        .from(tasks),
      db
        .select({
          id: conversations.id,
          projectId: conversations.projectId,
          taskId: conversations.taskId,
          archivedAt: conversations.archivedAt,
        })
        .from(conversations),
      db
        .select({ id: terminals.id, projectId: terminals.projectId, taskId: terminals.taskId })
        .from(terminals),
      db
        .select({
          id: workspaceTerminals.id,
          projectId: workspaceTerminals.projectId,
          scopeId: workspaceTerminals.scopeId,
        })
        .from(workspaceTerminals),
    ]);
  const projectArchivedAt = new Map(projectRows.map((row) => [row.id, row.archivedAt]));
  const taskById = new Map(taskRows.map((row) => [row.id, row]));
  const owners = new Map<string, TmuxPersistentOwner>();

  for (const row of conversationRows) {
    const task = taskById.get(row.taskId);
    const parentRelationshipValid =
      projectArchivedAt.has(row.projectId) && task?.projectId === row.projectId;
    const state = parentRelationshipValid
      ? ownerState(projectArchivedAt.get(row.projectId), task.archivedAt, row.archivedAt)
      : 'active';
    setOwner(owners, makePtySessionId(row.projectId, row.taskId, row.id), {
      kind: 'conversation',
      id: row.id,
      state,
      ...(!parentRelationshipValid ? { protected: true } : {}),
    });
  }
  for (const row of terminalRows) {
    const task = taskById.get(row.taskId);
    const parentRelationshipValid =
      projectArchivedAt.has(row.projectId) && task?.projectId === row.projectId;
    const state = parentRelationshipValid
      ? ownerState(projectArchivedAt.get(row.projectId), task.archivedAt)
      : 'active';
    setOwner(owners, makePtySessionId(row.projectId, row.taskId, row.id), {
      kind: 'task-terminal',
      id: row.id,
      state,
      ...(!parentRelationshipValid ? { protected: true } : {}),
    });
  }
  for (const row of workspaceTerminalRows) {
    const parentRelationshipValid = projectArchivedAt.has(row.projectId);
    setOwner(owners, makePtySessionId(row.projectId, row.scopeId, row.id), {
      kind: 'workspace-terminal',
      id: row.id,
      state: parentRelationshipValid ? ownerState(projectArchivedAt.get(row.projectId)) : 'active',
      ...(!parentRelationshipValid ? { protected: true } : {}),
    });
  }
  if (markers?.length) await attachColdConversationStatuses(markers, owners);
  return owners;
}

const CONVERSATION_STATUS_QUERY_CHUNK_SIZE = 250;

async function attachColdConversationStatuses(
  markers: readonly TmuxSessionMarker[],
  owners: Map<string, TmuxPersistentOwner>
): Promise<void> {
  const markerByConversationId = new Map<
    string,
    { marker: TmuxSessionMarker; sessionId: string; projectId: string; taskId: string }
  >();
  for (const marker of markers) {
    const sessionId = decodeTmuxSessionName(marker.sessionName);
    if (!sessionId) continue;
    const parsed = parsePtySessionId(sessionId);
    const owner = owners.get(sessionId);
    if (!parsed || owner?.kind !== 'conversation' || owner.protected) continue;
    markerByConversationId.set(owner.id, {
      marker,
      sessionId,
      projectId: parsed.projectId,
      taskId: parsed.scopeId,
    });
  }
  if (markerByConversationId.size === 0) return;

  const conversationIds = [...markerByConversationId.keys()];
  const candidates: ColdConversationReclamationCandidate[] = [];
  for (
    let offset = 0;
    offset < conversationIds.length;
    offset += CONVERSATION_STATUS_QUERY_CHUNK_SIZE
  ) {
    const ids = conversationIds.slice(offset, offset + CONVERSATION_STATUS_QUERY_CHUNK_SIZE);
    const rows = await db
      .select({
        id: conversations.id,
        projectId: conversations.projectId,
        taskId: conversations.taskId,
        runtimeId: conversations.runtime,
        title: conversations.title,
        createdAt: conversations.createdAt,
        config: conversations.config,
      })
      .from(conversations)
      .where(inArray(conversations.id, ids));
    for (const row of rows) {
      const target = markerByConversationId.get(row.id);
      if (!target || row.projectId !== target.projectId || row.taskId !== target.taskId) continue;
      candidates.push({
        sessionId: target.sessionId,
        projectId: row.projectId,
        taskId: row.taskId,
        conversationId: row.id,
        runtimeId: row.runtimeId,
        cwd: target.marker.cwd,
        title: row.title,
        createdAt: row.createdAt,
        config: row.config,
        ...(target.marker.panePid === undefined ? {} : { processPid: target.marker.panePid }),
        ...(target.marker.createdAtMs === undefined
          ? {}
          : { markerCreatedAtMs: target.marker.createdAtMs }),
      });
    }
  }

  const statuses = await resolveColdConversationReclamationStatuses(candidates);
  for (const [sessionId, coldStatus] of statuses) {
    const owner = owners.get(sessionId);
    if (owner?.kind === 'conversation' && !owner.protected) owner.coldStatus = coldStatus;
  }
}

export function buildTmuxReclamationSnapshot(input: {
  markers: TmuxSessionMarker[];
  owners: ReadonlyMap<string, TmuxPersistentOwner>;
  getDiagnostics: (sessionId: string) => PtySessionDiagnostics | null;
  nowMs: number;
  gracePeriodMs: number;
}): TmuxReclamationSnapshot {
  const items = input.markers.flatMap<TmuxReclamationItem>((marker) => {
    const sessionId = decodeTmuxSessionName(marker.sessionName);
    if (!sessionId) return [];
    const owner = input.owners.get(sessionId);
    const diagnostics = input.getDiagnostics(sessionId);
    const blockers: TmuxReclamationBlocker[] = [];
    const lastActivityAtMs = marker.lastActivityAtMs ?? marker.createdAtMs;
    const attachedClients = marker.attachedClients ?? 0;

    const conversationIsDurablyIdle =
      owner?.kind === 'conversation' && !owner.protected && owner.coldStatus === 'idle';
    if (
      (owner?.kind === 'conversation' && !conversationIsDurablyIdle) ||
      (owner?.kind !== 'conversation' && owner?.state === 'active')
    ) {
      blockers.push('active-owner');
    }
    if (attachedClients > 0) blockers.push('attached-client');
    if (diagnostics?.live || diagnostics?.registering) blockers.push('live-pty');
    if ((diagnostics?.consumerCount ?? 0) > 0) blockers.push('renderer-consumer');
    if (
      marker.createdAtMs === undefined ||
      marker.panePid === undefined ||
      lastActivityAtMs === undefined
    ) {
      blockers.push('unknown-activity');
    } else if (input.nowMs - lastActivityAtMs < input.gracePeriodMs) {
      blockers.push('grace-period');
    }

    return [
      {
        sessionId,
        sessionName: marker.sessionName,
        cwd: marker.cwd,
        ownerKind: owner?.kind ?? 'unknown',
        ownerId: owner?.id ?? null,
        ownerState: owner?.state ?? 'missing',
        attachedClients,
        rendererConsumers: diagnostics?.consumerCount ?? 0,
        lastActivityAt:
          lastActivityAtMs === undefined ? null : new Date(lastActivityAtMs).toISOString(),
        reclaimable: blockers.length === 0,
        blockers,
      },
    ];
  });

  return {
    sampledAt: new Date(input.nowMs).toISOString(),
    gracePeriodMs: input.gracePeriodMs,
    sessionCount: items.length,
    activeOwnedCount: items.filter((item) => item.ownerState === 'active').length,
    archivedOwnedCount: items.filter((item) => item.ownerState === 'archived').length,
    missingOwnerCount: items.filter((item) => item.ownerState === 'missing').length,
    reclaimableCount: items.filter((item) => item.reclaimable).length,
    items,
  };
}

/** Inspect only the isolated local Yoda tmux server used by the desktop app. */
export async function getTmuxReclamationSnapshot(
  options: SnapshotOptions = {}
): Promise<TmuxReclamationSnapshot> {
  const ctx = options.ctx ?? new LocalExecutionContext();
  const dependencies = resolveDependencies(options.dependencies);
  try {
    const markers = await dependencies.listMarkers(ctx);
    const owners = markers.length === 0 ? new Map() : await dependencies.loadOwners(markers);
    return buildTmuxReclamationSnapshot({
      markers,
      owners,
      getDiagnostics: dependencies.getDiagnostics,
      nowMs: options.nowMs ?? Date.now(),
      gracePeriodMs: options.gracePeriodMs ?? TMUX_RECLAMATION_GRACE_PERIOD_MS,
    });
  } finally {
    if (!options.ctx) ctx.dispose();
  }
}

function sameTmuxInstance(
  initial: TmuxSessionMarker | undefined,
  refreshed: TmuxSessionMarker | undefined
): boolean {
  return (
    initial !== undefined &&
    refreshed !== undefined &&
    initial.createdAtMs !== undefined &&
    initial.panePid !== undefined &&
    initial.lastActivityAtMs !== undefined &&
    initial.createdAtMs === refreshed.createdAtMs &&
    initial.panePid === refreshed.panePid &&
    initial.lastActivityAtMs === refreshed.lastActivityAtMs
  );
}

/**
 * Explicit local-Yoda-tmux cleanup. Stale UI snapshots are ignored. Two
 * batched inventories re-read tmux, DB ownership, durable provider evidence,
 * and PTY state; only candidates whose tmux instance fingerprint is unchanged
 * reach bounded kill workers. This remains O(N) even with a large cold
 * inventory. `ctx` is only an injected test seam; the app API supplies none.
 */
let tmuxCleanupInFlight: Promise<TmuxCleanupResult> | null = null;

export function cleanupReclaimableTmuxSessions(
  options: CleanupOptions = {}
): Promise<TmuxCleanupResult> {
  if (tmuxCleanupInFlight) return tmuxCleanupInFlight;
  const cleanup = runTmuxCleanup(options);
  tmuxCleanupInFlight = cleanup;
  const clear = () => {
    if (tmuxCleanupInFlight === cleanup) tmuxCleanupInFlight = null;
  };
  void cleanup.then(clear, clear);
  return cleanup;
}

async function runTmuxCleanup(options: CleanupOptions): Promise<TmuxCleanupResult> {
  const ctx = options.ctx ?? new LocalExecutionContext();
  const dependencies = resolveDependencies(options.dependencies);
  const result: TmuxCleanupResult = {
    terminatedCount: 0,
    alreadyStoppedCount: 0,
    skippedCount: 0,
    failedSessionIds: [],
  };
  try {
    const gracePeriodMs = options.gracePeriodMs ?? TMUX_RECLAMATION_GRACE_PERIOD_MS;
    const initialMarkers = await dependencies.listMarkers(ctx);
    if (initialMarkers.length === 0) return result;
    const initialOwners = await dependencies.loadOwners(initialMarkers);
    const initial = buildTmuxReclamationSnapshot({
      markers: initialMarkers,
      owners: initialOwners,
      getDiagnostics: dependencies.getDiagnostics,
      nowMs: options.nowMs ?? Date.now(),
      gracePeriodMs,
    });
    const candidates = initial.items.filter((item) => item.reclaimable);
    if (candidates.length === 0) return result;

    const refreshedMarkers = await dependencies.listMarkers(ctx);
    const refreshedOwners =
      refreshedMarkers.length === 0 ? new Map() : await dependencies.loadOwners(refreshedMarkers);
    const refreshed = buildTmuxReclamationSnapshot({
      markers: refreshedMarkers,
      owners: refreshedOwners,
      getDiagnostics: dependencies.getDiagnostics,
      nowMs: Date.now(),
      gracePeriodMs,
    });
    const initialMarkerByName = new Map(
      initialMarkers.map((marker) => [marker.sessionName, marker])
    );
    const refreshedMarkerByName = new Map(
      refreshedMarkers.map((marker) => [marker.sessionName, marker])
    );
    const refreshedItemByName = new Map(refreshed.items.map((item) => [item.sessionName, item]));
    const verifiedCandidates: Array<{
      item: TmuxReclamationItem;
      marker: TmuxSessionMarker;
    }> = [];
    for (const candidate of candidates) {
      const refreshedMarker = refreshedMarkerByName.get(candidate.sessionName);
      const refreshedItem = refreshedItemByName.get(candidate.sessionName);
      if (!refreshedMarker || !refreshedItem) {
        result.alreadyStoppedCount += 1;
        continue;
      }
      if (
        !refreshedItem.reclaimable ||
        !sameTmuxInstance(initialMarkerByName.get(candidate.sessionName), refreshedMarker)
      ) {
        result.skippedCount += 1;
        continue;
      }
      verifiedCandidates.push({ item: candidate, marker: refreshedMarker });
    }

    const killFailures: TmuxReclamationItem[] = [];
    let nextCandidateIndex = 0;
    const killNext = async (): Promise<void> => {
      while (nextCandidateIndex < verifiedCandidates.length) {
        const { item: candidate, marker } = verifiedCandidates[nextCandidateIndex++];
        const finalDiagnostics = dependencies.getDiagnostics(candidate.sessionId);
        if (
          finalDiagnostics?.live ||
          finalDiagnostics?.registering ||
          (finalDiagnostics?.consumerCount ?? 0) > 0
        ) {
          result.skippedCount += 1;
          continue;
        }
        try {
          const outcome = await dependencies.killSession(ctx, marker);
          if (outcome === 'skipped') result.skippedCount += 1;
          else result.terminatedCount += 1;
        } catch {
          killFailures.push(candidate);
        }
      }
    };
    await Promise.all(
      Array.from(
        {
          length: Math.min(TMUX_RECLAMATION_CLEANUP_CONCURRENCY, verifiedCandidates.length),
        },
        killNext
      )
    );
    if (killFailures.length > 0) {
      const remainingNames = new Set(
        (await dependencies.listMarkers(ctx)).map((marker) => marker.sessionName)
      );
      for (const failure of killFailures) {
        if (remainingNames.has(failure.sessionName)) {
          result.failedSessionIds.push(failure.sessionId);
        } else {
          result.alreadyStoppedCount += 1;
        }
      }
    }
    return result;
  } finally {
    if (!options.ctx) ctx.dispose();
  }
}
