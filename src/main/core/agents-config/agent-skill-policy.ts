import type { AgentDraft, AgentSkillPolicyMode } from '@shared/agents';

const ALLOWLIST_MARKER = 'policy:allowlist';
const AUTO_PREFIX = 'auto:';
const MANUAL_PREFIX = 'manual:';

export interface StoredAgentSkillPolicy {
  enabledSkillIds: string[];
  manualSkillIds: string[];
  skillPolicyMode: AgentSkillPolicyMode;
}

export function decodeStoredAgentSkillPolicy(raw: unknown): StoredAgentSkillPolicy {
  const values = Array.isArray(raw)
    ? raw.filter((value): value is string => typeof value === 'string')
    : [];
  const enabledSkillIds: string[] = [];
  const manualSkillIds: string[] = [];
  let explicitAllowlist = false;

  for (const value of values) {
    if (value === ALLOWLIST_MARKER) {
      explicitAllowlist = true;
    } else if (value.startsWith(MANUAL_PREFIX)) {
      manualSkillIds.push(value.slice(MANUAL_PREFIX.length));
    } else if (value.startsWith(AUTO_PREFIX)) {
      enabledSkillIds.push(value.slice(AUTO_PREFIX.length));
    } else {
      // Legacy rows stored plain ids as automatic skills.
      enabledSkillIds.push(value);
    }
  }

  return {
    enabledSkillIds,
    manualSkillIds,
    skillPolicyMode:
      explicitAllowlist || enabledSkillIds.length > 0 || manualSkillIds.length > 0
        ? 'allowlist'
        : 'runtime-defaults',
  };
}

export function encodeAgentSkillPolicy(
  draft: Pick<AgentDraft, 'enabledSkillIds' | 'manualSkillIds' | 'skillPolicyMode'>
): string[] {
  if (draft.skillPolicyMode === 'runtime-defaults') return [];
  return [
    ALLOWLIST_MARKER,
    ...draft.enabledSkillIds.map((skillId) => `${AUTO_PREFIX}${skillId}`),
    ...draft.manualSkillIds.map((skillId) => `${MANUAL_PREFIX}${skillId}`),
  ];
}
