import type { AgentAccountProviderId } from '@shared/runtime-registry';

export const DEFAULT_GATEWAY_SOURCE_ORDER: AgentAccountProviderId[] = [
  'official-api',
  'official-subscription',
  'yoda-maas',
];

export function resolveDefaultGatewaySource(
  availability: Record<AgentAccountProviderId, boolean>
): AgentAccountProviderId | null {
  return DEFAULT_GATEWAY_SOURCE_ORDER.find((id) => availability[id]) ?? null;
}
