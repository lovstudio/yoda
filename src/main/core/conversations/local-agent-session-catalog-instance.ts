import { runtimeOverrideSettings } from '@main/core/settings/runtime-settings-service';
import { LocalAgentSessionCatalog } from './local-agent-session-catalog';
import { sessionStateRootsCatalog } from './session-state-roots-catalog';

export const localAgentSessionCatalog = new LocalAgentSessionCatalog(
  sessionStateRootsCatalog,
  (runtimeId) => runtimeOverrideSettings.getItem(runtimeId)
);
