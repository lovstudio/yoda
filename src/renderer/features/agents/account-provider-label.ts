import type { AgentAccountProviderId } from '@shared/runtime-registry';

/**
 * How a session pays for its model calls: the vendor's own subscription, the
 * vendor's own API key, or a third-party platform routing on their behalf.
 *
 * One entity, one label set. Usage breakdowns, session chips, the runtime bar's
 * usage card and the access-method selector all name it through here, so a
 * session cannot read as "订阅" on one surface and "官方订阅" on the next.
 */
const ACCOUNT_PROVIDER_LABEL_KEYS: Record<AgentAccountProviderId, string> = {
  'official-subscription': 'agents.runtimeInfo.authProviders.official-subscription',
  'official-api': 'agents.runtimeInfo.authProviders.official-api',
  'yoda-maas': 'agents.runtimeInfo.authProviders.yoda-maas',
};

export function accountProviderLabelKey(id: AgentAccountProviderId): string {
  return ACCOUNT_PROVIDER_LABEL_KEYS[id];
}
