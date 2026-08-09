import { describe, expect, it } from 'vitest';
import { shouldHibernateIdleSession } from './idle-session-hibernation';

const base = {
  detachable: true,
  status: 'completed' as const,
  idleStatusIsAuthoritative: false,
  lastActivityAt: 0,
  now: 5 * 60_000,
  timeoutMs: 5 * 60_000,
  rendererConsumers: 0,
};

describe('shouldHibernateIdleSession', () => {
  it('hibernates hidden completed tmux sessions after the configured timeout', () => {
    expect(shouldHibernateIdleSession(base)).toBe(true);
  });

  it('keeps visible, heuristic-idle, and awaiting-input sessions alive', () => {
    expect(shouldHibernateIdleSession({ ...base, rendererConsumers: 1 })).toBe(false);
    expect(shouldHibernateIdleSession({ ...base, status: 'idle' })).toBe(false);
    expect(shouldHibernateIdleSession({ ...base, status: 'awaiting-input' })).toBe(false);
  });

  it('hibernates authoritative idle sessions after the configured timeout', () => {
    expect(
      shouldHibernateIdleSession({
        ...base,
        status: 'idle',
        idleStatusIsAuthoritative: true,
      })
    ).toBe(true);
  });

  it('uses the latest status or PTY activity instead of stale status alone', () => {
    expect(
      shouldHibernateIdleSession({
        ...base,
        lastActivityAt: base.now - base.timeoutMs + 1,
      })
    ).toBe(false);
  });
});
