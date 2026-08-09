import { describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { PtySessionDiagnostics } from './pty-session-registry';
import {
  buildTmuxReclamationSnapshot,
  cleanupReclaimableTmuxSessions,
  TMUX_RECLAMATION_CLEANUP_CONCURRENCY,
  type TmuxPersistentOwner,
} from './tmux-reclamation';
import { makeTmuxSessionName, type TmuxSessionMarker } from './tmux-session-name';

vi.mock('@main/db/client', () => ({ db: {} }));

const NOW = 2_000_000;
const GRACE = 100_000;

function marker(sessionId: string, overrides: Partial<TmuxSessionMarker> = {}): TmuxSessionMarker {
  return {
    sessionName: makeTmuxSessionName(sessionId),
    cwd: '/repo/worktree',
    panePid: 4321,
    createdAtMs: NOW - GRACE * 2,
    lastActivityAtMs: NOW - GRACE * 2,
    attachedClients: 0,
    ...overrides,
  };
}

function diagnostics(overrides: Partial<PtySessionDiagnostics> = {}): PtySessionDiagnostics {
  return {
    sessionId: 'session',
    live: false,
    outputBytesPerSecond: 0,
    lastOutputAt: null,
    lastInputAt: null,
    ringBufferBytes: 0,
    ringBufferCapBytes: 0,
    consumerCount: 0,
    pendingOutputBytes: 0,
    ...overrides,
  };
}

function snapshot(
  markers: TmuxSessionMarker[],
  owners: ReadonlyMap<string, TmuxPersistentOwner> = new Map(),
  getDiagnostics: (sessionId: string) => PtySessionDiagnostics | null = () => null
) {
  return buildTmuxReclamationSnapshot({
    markers,
    owners,
    getDiagnostics,
    nowMs: NOW,
    gracePeriodMs: GRACE,
  });
}

describe('tmux reclamation classification', () => {
  it('only reclaims old, detached sessions whose persistent owner is missing', () => {
    const sessionId = 'project-1:task-1:orphan';
    const result = snapshot([marker(sessionId)]);

    expect(result.reclaimableCount).toBe(1);
    expect(result.items[0]).toMatchObject({
      sessionId,
      ownerKind: 'unknown',
      ownerState: 'missing',
      reclaimable: true,
      blockers: [],
    });
  });

  it('protects active DB owners even after a long period without tmux activity', () => {
    const sessionId = 'project-1:task-1:conversation-1';
    const owners = new Map<string, TmuxPersistentOwner>([
      [sessionId, { kind: 'conversation', id: 'conversation-1', state: 'active' }],
    ]);

    expect(snapshot([marker(sessionId)], owners).items[0]).toMatchObject({
      reclaimable: false,
      blockers: ['active-owner'],
    });
  });

  it('allows an old detached active conversation only with a durable idle verdict', () => {
    const sessionId = 'project-1:task-1:conversation-1';
    const owners = new Map<string, TmuxPersistentOwner>([
      [
        sessionId,
        { kind: 'conversation', id: 'conversation-1', state: 'active', coldStatus: 'idle' },
      ],
    ]);

    expect(snapshot([marker(sessionId)], owners).items[0]).toMatchObject({
      ownerState: 'active',
      reclaimable: true,
      blockers: [],
    });
  });

  it.each(['working', 'awaiting-input', 'error', undefined] as const)(
    'keeps an active conversation protected when its durable verdict is %s',
    (coldStatus) => {
      const sessionId = 'project-1:task-1:conversation-1';
      const owners = new Map<string, TmuxPersistentOwner>([
        [
          sessionId,
          {
            kind: 'conversation',
            id: 'conversation-1',
            state: 'active',
            ...(coldStatus === undefined ? {} : { coldStatus }),
          },
        ],
      ]);

      expect(snapshot([marker(sessionId)], owners).items[0]).toMatchObject({
        reclaimable: false,
        blockers: ['active-owner'],
      });
    }
  );

  it('still applies attachment, PTY, consumer, and grace blockers to a durable idle owner', () => {
    const sessionId = 'project-1:task-1:conversation-1';
    const owners = new Map<string, TmuxPersistentOwner>([
      [
        sessionId,
        { kind: 'conversation', id: 'conversation-1', state: 'active', coldStatus: 'idle' },
      ],
    ]);
    const result = snapshot(
      [marker(sessionId, { attachedClients: 1, lastActivityAtMs: NOW - 1 })],
      owners,
      () => diagnostics({ live: true, consumerCount: 1 })
    );

    expect(result.items[0]?.blockers).toEqual([
      'attached-client',
      'live-pty',
      'renderer-consumer',
      'grace-period',
    ]);
  });

  it('requires archived conversations to be durably idle before reclamation', () => {
    const sessionId = 'project-1:task-1:archived-conversation';
    const archivedUnknown = new Map<string, TmuxPersistentOwner>([
      [sessionId, { kind: 'conversation', id: 'archived-conversation', state: 'archived' }],
    ]);
    const archivedWorking = new Map<string, TmuxPersistentOwner>([
      [
        sessionId,
        {
          kind: 'conversation',
          id: 'archived-conversation',
          state: 'archived',
          coldStatus: 'working',
        },
      ],
    ]);
    const archivedIdle = new Map<string, TmuxPersistentOwner>([
      [
        sessionId,
        {
          kind: 'conversation',
          id: 'archived-conversation',
          state: 'archived',
          coldStatus: 'idle',
        },
      ],
    ]);

    expect(snapshot([marker(sessionId)], archivedUnknown).items[0]?.blockers).toEqual([
      'active-owner',
    ]);
    expect(snapshot([marker(sessionId)], archivedWorking).items[0]?.blockers).toEqual([
      'active-owner',
    ]);
    expect(snapshot([marker(sessionId)], archivedIdle).items[0]).toMatchObject({
      ownerState: 'archived',
      reclaimable: true,
      blockers: [],
    });
  });

  it('keeps corrupt ownership protected even if provider evidence says idle', () => {
    const sessionId = 'project-1:task-1:conversation-1';
    const owners = new Map<string, TmuxPersistentOwner>([
      [
        sessionId,
        {
          kind: 'conversation',
          id: 'conversation-1',
          state: 'active',
          coldStatus: 'idle',
          protected: true,
        },
      ],
    ]);

    expect(snapshot([marker(sessionId)], owners).items[0]).toMatchObject({
      reclaimable: false,
      blockers: ['active-owner'],
    });
  });

  it('protects attached, recently active, live, and renderer-observed sessions', () => {
    const owners = new Map<string, TmuxPersistentOwner>();
    const markers = [
      marker('project:task:attached', { attachedClients: 1 }),
      marker('project:task:recent', { lastActivityAtMs: NOW - 1 }),
      marker('project:task:live'),
      marker('project:task:visible'),
      marker('project:task:unknown', { createdAtMs: undefined, lastActivityAtMs: undefined }),
    ];
    const result = snapshot(markers, owners, (sessionId) => {
      if (sessionId.endsWith(':live')) return diagnostics({ live: true });
      if (sessionId.endsWith(':visible')) return diagnostics({ consumerCount: 1 });
      return null;
    });

    expect(result.items.map((item) => item.blockers)).toEqual([
      ['attached-client'],
      ['grace-period'],
      ['live-pty'],
      ['renderer-consumer'],
      ['unknown-activity'],
    ]);
    expect(result.reclaimableCount).toBe(0);
  });

  it('matches workspace terminal IDs exactly even when the scope contains colons', () => {
    const sessionId = 'project-1:local:project-1:project-view:terminal-1';
    const owners = new Map<string, TmuxPersistentOwner>([
      [sessionId, { kind: 'workspace-terminal', id: 'terminal-1', state: 'active' }],
    ]);

    expect(snapshot([marker(sessionId)], owners).items[0]).toMatchObject({
      ownerKind: 'workspace-terminal',
      ownerId: 'terminal-1',
      ownerState: 'active',
      reclaimable: false,
    });
  });
});

describe('explicit tmux reclamation', () => {
  const ctx = {
    root: undefined,
    supportsLocalSpawn: true,
    exec: vi.fn(),
    execStreaming: vi.fn(),
    dispose: vi.fn(),
  } as unknown as IExecutionContext;

  it('revalidates activity immediately before killing a candidate', async () => {
    const sessionId = 'project:task:orphan';
    const initial = marker(sessionId);
    const changed = marker(sessionId, { lastActivityAtMs: NOW - GRACE * 3 });
    const listMarkers = vi.fn().mockResolvedValueOnce([initial]).mockResolvedValueOnce([changed]);
    const killSession = vi.fn();

    const result = await cleanupReclaimableTmuxSessions({
      ctx,
      nowMs: NOW,
      gracePeriodMs: GRACE,
      dependencies: {
        listMarkers,
        loadOwners: async () => new Map(),
        getDiagnostics: () => null,
        killSession,
      },
    });

    expect(killSession).not.toHaveBeenCalled();
    expect(result.skippedCount).toBe(1);
  });

  it('kills a candidate that is still ownerless, detached, hidden, and old', async () => {
    const sessionId = 'project:task:orphan';
    const current = marker(sessionId);
    const killSession = vi.fn().mockResolvedValue(undefined);

    const result = await cleanupReclaimableTmuxSessions({
      ctx,
      nowMs: NOW,
      gracePeriodMs: GRACE,
      dependencies: {
        listMarkers: vi.fn().mockResolvedValue([current]),
        loadOwners: async () => new Map(),
        getDiagnostics: () => null,
        killSession,
      },
    });

    expect(killSession).toHaveBeenCalledWith(ctx, current);
    expect(result).toMatchObject({ terminatedCount: 1, skippedCount: 0 });
  });

  it('does not kill a cold owner that becomes working during batched revalidation', async () => {
    const sessionId = 'project:task:conversation';
    const current = marker(sessionId);
    const idleOwner: TmuxPersistentOwner = {
      kind: 'conversation',
      id: 'conversation',
      state: 'active',
      coldStatus: 'idle',
    };
    const killSession = vi.fn();
    const loadOwners = vi
      .fn()
      .mockResolvedValueOnce(new Map([[sessionId, idleOwner]]))
      .mockResolvedValueOnce(new Map([[sessionId, { ...idleOwner, coldStatus: 'working' }]]));

    const result = await cleanupReclaimableTmuxSessions({
      ctx,
      nowMs: NOW,
      gracePeriodMs: GRACE,
      dependencies: {
        listMarkers: vi.fn().mockResolvedValue([current]),
        loadOwners,
        getDiagnostics: () => null,
        killSession,
      },
    });

    expect(killSession).not.toHaveBeenCalled();
    expect(result.skippedCount).toBe(1);
  });

  it('fails closed when the batched ownership or provider revalidation fails', async () => {
    const sessionId = 'project:task:conversation';
    const current = marker(sessionId);
    const idleOwner: TmuxPersistentOwner = {
      kind: 'conversation',
      id: 'conversation',
      state: 'active',
      coldStatus: 'idle',
    };
    const killSession = vi.fn();
    const loadOwners = vi
      .fn()
      .mockResolvedValueOnce(new Map([[sessionId, idleOwner]]))
      .mockRejectedValueOnce(new Error('provider evidence unavailable'));

    await expect(
      cleanupReclaimableTmuxSessions({
        ctx,
        nowMs: NOW,
        gracePeriodMs: GRACE,
        dependencies: {
          listMarkers: vi.fn().mockResolvedValue([current]),
          loadOwners,
          getDiagnostics: () => null,
          killSession,
        },
      })
    ).rejects.toThrow('provider evidence unavailable');
    expect(killSession).not.toHaveBeenCalled();
  });

  it('bounds independent kills for a large cold inventory', async () => {
    const sessionIds = Array.from(
      { length: TMUX_RECLAMATION_CLEANUP_CONCURRENCY * 2 + 1 },
      (_, index) => `project:task:orphan-${index}`
    );
    const markers = sessionIds.map((sessionId) => marker(sessionId));
    let active = 0;
    let maxActive = 0;
    const killSession = vi.fn().mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      active -= 1;
    });

    const result = await cleanupReclaimableTmuxSessions({
      ctx,
      nowMs: NOW,
      gracePeriodMs: GRACE,
      dependencies: {
        listMarkers: vi.fn().mockResolvedValue(markers),
        loadOwners: async () => new Map(),
        getDiagnostics: () => null,
        killSession,
      },
    });

    expect(result.terminatedCount).toBe(markers.length);
    expect(maxActive).toBe(TMUX_RECLAMATION_CLEANUP_CONCURRENCY);
  });

  it.each([
    ['creation time', { createdAtMs: NOW - GRACE * 4 }],
    ['pane pid', { panePid: 222 }],
  ])(
    'rejects an ABA replacement whose %s changed under the same name',
    async (_label, replacementIdentity) => {
      const sessionId = 'project:task:orphan';
      const initial = marker(sessionId, { panePid: 111, createdAtMs: NOW - GRACE * 3 });
      const replacement = marker(sessionId, {
        lastActivityAtMs: initial.lastActivityAtMs,
        panePid: initial.panePid,
        createdAtMs: initial.createdAtMs,
        ...replacementIdentity,
      });
      const listMarkers = vi
        .fn()
        .mockResolvedValueOnce([initial])
        .mockResolvedValueOnce([replacement]);
      const killSession = vi.fn();

      const result = await cleanupReclaimableTmuxSessions({
        ctx,
        nowMs: NOW,
        gracePeriodMs: GRACE,
        dependencies: {
          listMarkers,
          loadOwners: async () => new Map(),
          getDiagnostics: () => null,
          killSession,
        },
      });

      expect(killSession).not.toHaveBeenCalled();
      expect(result.skippedCount).toBe(1);
    }
  );

  it.each([
    ['registration', diagnostics({ registering: true })],
    ['listener-first consumer', diagnostics({ consumerCount: 1 })],
  ])('rechecks %s lifecycle state immediately before conditional kill', async (_label, final) => {
    const sessionId = 'project:task:orphan';
    const current = marker(sessionId);
    const getDiagnostics = vi
      .fn()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(final);
    const killSession = vi.fn();

    const result = await cleanupReclaimableTmuxSessions({
      ctx,
      nowMs: NOW,
      gracePeriodMs: GRACE,
      dependencies: {
        listMarkers: vi.fn().mockResolvedValue([current]),
        loadOwners: async () => new Map(),
        getDiagnostics,
        killSession,
      },
    });

    expect(killSession).not.toHaveBeenCalled();
    expect(result.skippedCount).toBe(1);
  });

  it('treats an atomic marker mismatch as a safe skip without failure reconciliation', async () => {
    const sessionId = 'project:task:orphan';
    const current = marker(sessionId);
    const listMarkers = vi.fn().mockResolvedValue([current]);

    const result = await cleanupReclaimableTmuxSessions({
      ctx,
      nowMs: NOW,
      gracePeriodMs: GRACE,
      dependencies: {
        listMarkers,
        loadOwners: async () => new Map(),
        getDiagnostics: () => null,
        killSession: vi.fn().mockResolvedValue('skipped'),
      },
    });

    expect(result).toMatchObject({ terminatedCount: 0, skippedCount: 1, failedSessionIds: [] });
    expect(listMarkers).toHaveBeenCalledTimes(2);
  });

  it('reconciles all real kill failures with one final strict inventory', async () => {
    const first = marker('project:task:first');
    const second = marker('project:task:second');
    const listMarkers = vi
      .fn()
      .mockResolvedValueOnce([first, second])
      .mockResolvedValueOnce([first, second])
      .mockResolvedValueOnce([first]);

    const result = await cleanupReclaimableTmuxSessions({
      ctx,
      nowMs: NOW,
      gracePeriodMs: GRACE,
      dependencies: {
        listMarkers,
        loadOwners: async () => new Map(),
        getDiagnostics: () => null,
        killSession: vi.fn().mockRejectedValue(new Error('tmux failure')),
      },
    });

    expect(result.failedSessionIds).toEqual(['project:task:first']);
    expect(result.alreadyStoppedCount).toBe(1);
    expect(listMarkers).toHaveBeenCalledTimes(3);
  });

  it('short-circuits owner inventory when the local Yoda tmux server is empty', async () => {
    const loadOwners = vi.fn();

    await expect(
      cleanupReclaimableTmuxSessions({
        ctx,
        dependencies: {
          listMarkers: vi.fn().mockResolvedValue([]),
          loadOwners,
          getDiagnostics: () => null,
          killSession: vi.fn(),
        },
      })
    ).resolves.toMatchObject({ terminatedCount: 0 });
    expect(loadOwners).not.toHaveBeenCalled();
  });

  it('coalesces concurrent explicit cleanup requests into one local scan', async () => {
    let finishList!: (markers: TmuxSessionMarker[]) => void;
    const listMarkers = vi.fn(
      () =>
        new Promise<TmuxSessionMarker[]>((resolve) => {
          finishList = resolve;
        })
    );
    const options = {
      ctx,
      dependencies: {
        listMarkers,
        loadOwners: vi.fn(),
        getDiagnostics: () => null,
        killSession: vi.fn(),
      },
    };

    const first = cleanupReclaimableTmuxSessions(options);
    const second = cleanupReclaimableTmuxSessions(options);

    expect(second).toBe(first);
    finishList([]);
    await first;
    expect(listMarkers).toHaveBeenCalledTimes(1);
  });
});
