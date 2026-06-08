import { describe, expect, it } from 'vitest';
import {
  initialRunState,
  POST_SUBMIT_NOTIFICATION_GRACE_MS,
  reduceRunState,
  type PendingAction,
  type RunState,
} from './agent-run-state';

const permissionPrompt: PendingAction = { notificationType: 'permission_prompt' };
const idlePrompt: PendingAction = { notificationType: 'idle_prompt' };

function working(at = 1000): RunState {
  return reduceRunState(initialRunState('idle', 0), { kind: 'turn-started', at, force: true });
}

describe('reduceRunState', () => {
  it('initial idle is seen with no pending action', () => {
    const s = initialRunState();
    expect(s.status).toBe('idle');
    expect(s.seen).toBe(true);
    expect(s.pendingAction).toBeNull();
  });

  it('turn-started → working, seen, clears pending action', () => {
    const s = reduceRunState(initialRunState(), { kind: 'turn-started', at: 5 });
    expect(s.status).toBe('working');
    expect(s.seen).toBe(true);
    expect(s.pendingAction).toBeNull();
  });

  it('turn-completed → completed, unseen', () => {
    const s = reduceRunState(working(), { kind: 'turn-completed', at: 2000 });
    expect(s.status).toBe('completed');
    expect(s.seen).toBe(false);
  });

  it('turn-failed → error, unseen', () => {
    const s = reduceRunState(working(), { kind: 'turn-failed', at: 2000 });
    expect(s.status).toBe('error');
    expect(s.seen).toBe(false);
  });

  it('turn-interrupted → idle (non-terminal), seen, no error', () => {
    const s = reduceRunState(working(), { kind: 'turn-interrupted', at: 2000 });
    expect(s.status).toBe('idle');
    expect(s.seen).toBe(true);
  });

  it('awaiting-input on attention notification → awaiting-input, unseen, carries context', () => {
    const s = reduceRunState(initialRunState(), {
      kind: 'awaiting-input',
      at: 10,
      pendingAction: { ...permissionPrompt, toolName: 'Edit', actionDescription: 'Editing a.ts' },
    });
    expect(s.status).toBe('awaiting-input');
    expect(s.seen).toBe(false);
    expect(s.pendingAction?.toolName).toBe('Edit');
  });

  it('ignores non-attention notifications (e.g. auth_success)', () => {
    const before = initialRunState();
    const s = reduceRunState(before, {
      kind: 'awaiting-input',
      at: 10,
      pendingAction: { notificationType: 'auth_success' },
    });
    expect(s).toBe(before);
  });

  it('suppresses awaiting-input echo within grace window after forced working', () => {
    const w = working(1000);
    const s = reduceRunState(w, {
      kind: 'awaiting-input',
      at: 1000 + POST_SUBMIT_NOTIFICATION_GRACE_MS - 1,
      pendingAction: permissionPrompt,
    });
    expect(s.status).toBe('working');
  });

  it('allows awaiting-input after grace window elapses', () => {
    const w = working(1000);
    const s = reduceRunState(w, {
      kind: 'awaiting-input',
      at: 1000 + POST_SUBMIT_NOTIFICATION_GRACE_MS + 1,
      pendingAction: permissionPrompt,
    });
    expect(s.status).toBe('awaiting-input');
  });

  it('non-forced turn-started does not clear a pending permission prompt', () => {
    const awaiting = reduceRunState(initialRunState(), {
      kind: 'awaiting-input',
      at: 10,
      pendingAction: permissionPrompt,
    });
    const s = reduceRunState(awaiting, { kind: 'turn-started', at: 20 });
    expect(s.status).toBe('awaiting-input');
  });

  it('forced turn-started overrides a pending permission prompt', () => {
    const awaiting = reduceRunState(initialRunState(), {
      kind: 'awaiting-input',
      at: 10,
      pendingAction: permissionPrompt,
    });
    const s = reduceRunState(awaiting, { kind: 'turn-started', at: 20, force: true });
    expect(s.status).toBe('working');
    expect(s.pendingAction).toBeNull();
  });

  it('non-forced turn-started clears a non-permission awaiting state (idle prompt)', () => {
    const awaiting = reduceRunState(initialRunState(), {
      kind: 'awaiting-input',
      at: 10,
      pendingAction: idlePrompt,
    });
    const s = reduceRunState(awaiting, { kind: 'turn-started', at: 20 });
    expect(s.status).toBe('working');
  });

  it('process-exited clears running state to idle', () => {
    const s = reduceRunState(working(), { kind: 'process-exited', at: 3000 });
    expect(s.status).toBe('idle');
  });

  it('process-exited preserves a terminal status (completed stays completed)', () => {
    const completed = reduceRunState(working(), { kind: 'turn-completed', at: 2000 });
    const s = reduceRunState(completed, { kind: 'process-exited', at: 3000 });
    expect(s.status).toBe('completed');
    expect(s.seen).toBe(false);
  });

  it('watchdog-idle only fires on running states', () => {
    const completed = reduceRunState(working(), { kind: 'turn-completed', at: 2000 });
    const s = reduceRunState(completed, { kind: 'watchdog-idle', at: 9999 });
    expect(s).toBe(completed);

    const w = working();
    const s2 = reduceRunState(w, { kind: 'watchdog-idle', at: 9999 });
    expect(s2.status).toBe('idle');
  });

  it('mark-seen clears unseen terminal status', () => {
    const completed = reduceRunState(working(), { kind: 'turn-completed', at: 2000 });
    expect(completed.seen).toBe(false);
    const s = reduceRunState(completed, { kind: 'mark-seen', at: 2500 });
    expect(s.seen).toBe(true);
    expect(s.status).toBe('completed');
  });

  it('is idempotent: replaying a terminal event does not resurrect running', () => {
    const completed = reduceRunState(working(), { kind: 'turn-completed', at: 2000 });
    const again = reduceRunState(completed, { kind: 'turn-completed', at: 2001 });
    expect(again.status).toBe('completed');
  });
});
