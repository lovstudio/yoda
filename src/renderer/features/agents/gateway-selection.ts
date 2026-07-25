import { isMaasPlatformId, type MaasPlatformId } from '@shared/maas';
import type { AgentAccountProviderId } from '@shared/runtime-registry';

export type GatewaySelection =
  | Exclude<AgentAccountProviderId, 'yoda-maas'>
  | `yoda-maas:${MaasPlatformId}`;

const MAAS_SELECTION_PREFIX = 'yoda-maas:';

export function parseGatewaySelection(value: GatewaySelection | null): {
  authProvider: AgentAccountProviderId;
  maasPlatformId?: MaasPlatformId;
} | null {
  if (!value) return null;
  if (!value.startsWith(MAAS_SELECTION_PREFIX)) {
    return {
      authProvider: value as Exclude<AgentAccountProviderId, 'yoda-maas'>,
    };
  }

  const candidate = value.slice(MAAS_SELECTION_PREFIX.length);
  if (!isMaasPlatformId(candidate)) return null;
  return { authProvider: 'yoda-maas', maasPlatformId: candidate };
}
