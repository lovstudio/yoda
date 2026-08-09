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
  const hasHibernatableStatus =
    input.status === 'completed' || (input.status === 'idle' && input.idleStatusIsAuthoritative);
  return (
    input.timeoutMs > 0 &&
    input.detachable &&
    hasHibernatableStatus &&
    input.now - input.lastActivityAt >= input.timeoutMs &&
    input.rendererConsumers === 0
  );
}
