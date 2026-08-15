import type { AgentSessionRuntimeStatus } from '@shared/events/agentEvents';

export function shouldHibernateIdleSession(input: {
  detachable: boolean;
  status: AgentSessionRuntimeStatus;
  idleStatusIsAuthoritative: boolean;
  lastActivityAt: number;
  now: number;
  timeoutMs: number;
  rendererConsumers: number;
}): boolean {
  // `interrupted` needs no authority guard: unlike `idle`, it is only ever
  // reached from positive evidence that the turn ended, so the session is as
  // safe to detach as a completed one.
  const hasHibernatableStatus =
    input.status === 'completed' ||
    input.status === 'interrupted' ||
    (input.status === 'idle' && input.idleStatusIsAuthoritative);
  return (
    input.timeoutMs > 0 &&
    input.detachable &&
    hasHibernatableStatus &&
    input.now - input.lastActivityAt >= input.timeoutMs &&
    input.rendererConsumers === 0
  );
}
