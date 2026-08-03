import type { AgentSessionRuntimeStatus } from '@shared/events/agentEvents';

export function shouldHibernateIdleSession(input: {
  detachable: boolean;
  status: AgentSessionRuntimeStatus;
  statusChangedAt: number;
  now: number;
  timeoutMs: number;
  rendererConsumers: number;
}): boolean {
  return (
    input.timeoutMs > 0 &&
    input.detachable &&
    input.status === 'completed' &&
    input.now - input.statusChangedAt >= input.timeoutMs &&
    input.rendererConsumers === 0
  );
}
