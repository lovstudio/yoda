import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialRunState, type RunState, type RunStateEvent } from '@shared/events/agent-run-state';
import type { AgentSessionRuntimeStatus } from '@shared/events/agentEvents';
import {
  getClaudeSessionActivity,
  parseClaudeSessionActivity,
  watchClaudeSessionActivity,
  type ClaudeSessionActivityContext,
  type ClaudeSessionActivityWatcher,
} from './claude-session-activity-source';
import { clearInterruptMarker, markInterrupted } from './interrupt-marker';

vi.mock('@main/lib/logger', () => ({
  log: {
    warn: vi.fn(),
  },
}));

function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('timeout'));
      setTimeout(tick, 20);
    };
    tick();
  });
}

describe('parseClaudeSessionActivity', () => {
  it('parses Claude session activity files', () => {
    expect(
      parseClaudeSessionActivity(
        JSON.stringify({
          pid: 123,
          sessionId: 'conv-1',
          cwd: '/repo',
          status: 'busy',
          updatedAt: 1_781_115_179_335,
        })
      )
    ).toEqual({
      pid: 123,
      sessionId: 'conv-1',
      cwd: '/repo',
      status: 'busy',
      waitingFor: null,
      updatedAt: 1_781_115_179_335,
      startedAt: null,
    });
  });

  it('rejects unrelated JSON', () => {
    expect(parseClaudeSessionActivity('{}')).toBeNull();
    expect(
      parseClaudeSessionActivity(JSON.stringify({ sessionId: 'x', status: 'done' }))
    ).toBeNull();
  });
});

describe('watchClaudeSessionActivity', () => {
  let claudeHomeDir: string;
  let sessionsDir: string;
  let watcher: ClaudeSessionActivityWatcher | null = null;
  let events: RunStateEvent[] = [];
  let storeState: RunState = initialRunState();

  beforeEach(() => {
    claudeHomeDir = mkdtempSync(join(tmpdir(), 'yoda-claude-activity-'));
    sessionsDir = join(claudeHomeDir, 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    events = [];
    storeState = initialRunState();
  });

  /** The reducer status this conversation holds, as the store would report it. */
  function setStoreStatus(status: AgentSessionRuntimeStatus, updatedAt = 0): void {
    storeState = initialRunState(status, updatedAt);
  }

  afterEach(() => {
    watcher?.stop();
    watcher = null;
    clearInterruptMarker('conv-1');
    rmSync(claudeHomeDir, { recursive: true, force: true });
  });

  function start(ctx: Omit<ClaudeSessionActivityContext, 'cwd' | 'conversationId'> = {}): void {
    watcher = watchClaudeSessionActivity(
      { cwd: '/repo', conversationId: 'conv-1', claudeHomeDir, ...ctx },
      (event) => events.push(event),
      () => storeState
    );
  }

  function writeSession(
    status: 'busy' | 'idle' | 'waiting',
    updatedAt = Date.now(),
    overrides: {
      pid?: number;
      sessionId?: string;
      cwd?: string;
      waitingFor?: string;
      startedAt?: number;
    } = {}
  ): void {
    const pid = overrides.pid ?? 123;
    writeFileSync(
      join(sessionsDir, `${pid}.json`),
      JSON.stringify({
        pid,
        sessionId: overrides.sessionId ?? 'conv-1',
        cwd: overrides.cwd ?? '/repo',
        status,
        waitingFor:
          status === 'waiting' ? (overrides.waitingFor ?? 'approve AskUserQuestion') : undefined,
        updatedAt,
        startedAt: overrides.startedAt ?? 0,
      })
    );
  }

  it('reads matching Claude session activity for session info', async () => {
    writeSession('busy', 1_781_115_179_335);

    await expect(
      getClaudeSessionActivity({
        cwd: '/repo',
        conversationId: 'conv-1',
        claudeHomeDir,
      })
    ).resolves.toEqual({
      pid: 123,
      sessionId: 'conv-1',
      cwd: '/repo',
      status: 'busy',
      waitingFor: null,
      updatedAt: 1_781_115_179_335,
      startedAt: 0,
    });
  });

  it('prioritizes the exact process pid over session id and cwd', async () => {
    writeSession('busy', Date.now(), {
      pid: 456,
      sessionId: 'claude-session-id',
      cwd: '/symlinked-repo',
    });

    await expect(
      getClaudeSessionActivity({
        cwd: '/repo',
        conversationId: 'conv-1',
        processPid: 456,
        claudeHomeDir,
      })
    ).resolves.toMatchObject({ pid: 456, status: 'busy' });
  });

  it('dispatches working and awaiting-input directly from activity status', async () => {
    writeSession('busy');
    start();

    await waitFor(() => events.some((event) => event.kind === 'turn-started'));
    writeSession('waiting', Date.now() + 1);

    await waitFor(() => events.some((event) => event.kind === 'awaiting-input'));
    expect(events.at(-1)).toMatchObject({
      kind: 'awaiting-input',
      pendingAction: {
        notificationType: 'elicitation_dialog',
        toolName: 'approve AskUserQuestion',
      },
    });
  });

  it('forces working when Claude resumes after waiting', async () => {
    writeSession('waiting');
    start();

    await waitFor(() => events.some((event) => event.kind === 'awaiting-input'));
    writeSession('busy', Date.now() + 1);

    await waitFor(() =>
      events.some(
        (event) => event.kind === 'turn-started' && 'force' in event && event.force === true
      )
    );
  });

  it.each([
    ['busy', 'turn-started', 'turn-completed'],
    ['waiting', 'awaiting-input', 'turn-interrupted'],
  ] as const)(
    'maps %s to idle without reading a transcript',
    async (initial, initialEvent, idleEvent) => {
      writeSession(initial);
      start({ idleSettleMs: 10 });

      await waitFor(() => events.some((event) => event.kind === initialEvent));
      writeSession('idle', Date.now() + 1);

      await waitFor(() => events.some((event) => event.kind === idleEvent));
      expect(events.at(-1)?.kind).toBe(idleEvent);
    }
  );

  it('preserves a user interrupt when busy returns to idle', async () => {
    writeSession('busy');
    start({ idleSettleMs: 10 });

    await waitFor(() => events.some((event) => event.kind === 'turn-started'));
    markInterrupted('conv-1');
    writeSession('idle', Date.now() + 1);

    await waitFor(() => events.some((event) => event.kind === 'turn-interrupted'));
  });

  it('leaves a running status alone when a resumed process boots to its prompt', async () => {
    // Claude writes `idle` about a second after startup, and the watcher only
    // exists because the user opened the task. Publishing that first read would
    // make a running task go idle on click.
    setStoreStatus('working', Date.now() - 60_000);
    writeSession('idle', Date.now(), { startedAt: Date.now() });
    start();

    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(events).toEqual([]);
  });

  it('ignores stale activity files when attaching a live watcher', async () => {
    writeSession('busy', Date.now() - 10_000);
    start();

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(events).toEqual([]);
  });

  describe('reconciling a running status the record contradicts', () => {
    const seams = { reconcileIntervalMs: 20, reconcileMinIdleAgeMs: 50 };

    it('settles an awaiting-input the record never confirmed', async () => {
      // The record is well past the edge-triggered path's staleness window, so
      // nothing but the reconciler can correct the status.
      writeSession('idle', Date.now() - 10_000);
      setStoreStatus('awaiting-input', Date.now() - 10_000);
      start(seams);

      await waitFor(() => events.some((event) => event.kind === 'turn-completed'));
    });

    it('reports a settled turn as interrupted when the user cut it short', async () => {
      writeSession('idle', Date.now() - 10_000);
      setStoreStatus('working', Date.now() - 10_000);
      markInterrupted('conv-1');
      start(seams);

      await waitFor(() => events.some((event) => event.kind === 'turn-interrupted'));
    });

    it('leaves a running status alone while the record still reports busy', async () => {
      writeSession('busy', Date.now() - 10_000);
      setStoreStatus('working', Date.now() - 10_000);
      start(seams);

      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(events).toEqual([]);
    });

    it('leaves a turn the reducer only just started alone', async () => {
      // A submit is mirrored optimistically before Claude rewrites the record,
      // so a young `working` must outlive an already-idle record.
      writeSession('idle', Date.now() - 10_000);
      setStoreStatus('working', Date.now());
      start({ ...seams, reconcileMinIdleAgeMs: 5_000 });

      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(events).toEqual([]);
    });

    it('waits for an idle record to settle before overruling a running status', async () => {
      // A record Claude wrote moments ago may simply not have caught up with the
      // work it just picked up.
      writeSession('idle', Date.now());
      setStoreStatus('working', Date.now() - 10_000);
      start({ ...seams, reconcileMinIdleAgeMs: 5_000 });

      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(events.map((event) => event.kind)).not.toContain('turn-completed');
    });

    it('ignores an idle record from a process that started after the turn', async () => {
      // The CLI was replaced (resume, idle-timeout release) after the status was
      // set, so its prompt is a boot state and says nothing about that turn. A
      // process that really died mid-turn is reported by the exit path instead.
      const now = Date.now();
      writeSession('idle', now - 9_000, { startedAt: now - 10_000 });
      setStoreStatus('working', now - 20_000);
      start(seams);

      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(events).toEqual([]);
    });

    it('leaves a terminal status alone', async () => {
      writeSession('idle', Date.now() - 10_000);
      setStoreStatus('completed', Date.now() - 10_000);
      start(seams);

      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(events).toEqual([]);
    });
  });
});
