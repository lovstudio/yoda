import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunStateEvent } from '@shared/events/agent-run-state';
import {
  getClaudeSessionActivity,
  parseClaudeSessionActivity,
  watchClaudeSessionActivity,
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

  beforeEach(() => {
    claudeHomeDir = mkdtempSync(join(tmpdir(), 'yoda-claude-activity-'));
    sessionsDir = join(claudeHomeDir, 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
  });

  afterEach(() => {
    watcher?.stop();
    watcher = null;
    clearInterruptMarker('conv-1');
    rmSync(claudeHomeDir, { recursive: true, force: true });
  });

  function writeSession(
    status: 'busy' | 'idle' | 'waiting',
    updatedAt = Date.now(),
    overrides: { pid?: number; sessionId?: string; cwd?: string; waitingFor?: string } = {}
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
    const events: RunStateEvent[] = [];
    writeSession('busy');
    watcher = watchClaudeSessionActivity(
      { cwd: '/repo', conversationId: 'conv-1', claudeHomeDir },
      (event) => events.push(event)
    );

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
    const events: RunStateEvent[] = [];
    writeSession('waiting');
    watcher = watchClaudeSessionActivity(
      { cwd: '/repo', conversationId: 'conv-1', claudeHomeDir },
      (event) => events.push(event)
    );

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
      const events: RunStateEvent[] = [];
      writeSession(initial);
      watcher = watchClaudeSessionActivity(
        { cwd: '/repo', conversationId: 'conv-1', claudeHomeDir, idleSettleMs: 10 },
        (event) => events.push(event)
      );

      await waitFor(() => events.some((event) => event.kind === initialEvent));
      writeSession('idle', Date.now() + 1);

      await waitFor(() => events.some((event) => event.kind === idleEvent));
      expect(events.at(-1)?.kind).toBe(idleEvent);
    }
  );

  it('preserves a user interrupt when busy returns to idle', async () => {
    const events: RunStateEvent[] = [];
    writeSession('busy');
    watcher = watchClaudeSessionActivity(
      { cwd: '/repo', conversationId: 'conv-1', claudeHomeDir, idleSettleMs: 10 },
      (event) => events.push(event)
    );

    await waitFor(() => events.some((event) => event.kind === 'turn-started'));
    markInterrupted('conv-1');
    writeSession('idle', Date.now() + 1);

    await waitFor(() => events.some((event) => event.kind === 'turn-interrupted'));
  });

  it('reconciles an already-idle process on attach', async () => {
    const events: RunStateEvent[] = [];
    writeSession('idle');
    watcher = watchClaudeSessionActivity(
      { cwd: '/repo', conversationId: 'conv-1', claudeHomeDir },
      (event) => events.push(event)
    );

    await waitFor(() => events.some((event) => event.kind === 'watchdog-idle'));
  });

  it('ignores stale activity files when attaching a live watcher', async () => {
    const events: RunStateEvent[] = [];
    writeSession('busy', Date.now() - 10_000);
    watcher = watchClaudeSessionActivity(
      { cwd: '/repo', conversationId: 'conv-1', claudeHomeDir },
      (event) => events.push(event)
    );

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(events).toEqual([]);
  });
});
