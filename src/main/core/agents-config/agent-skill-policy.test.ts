import { describe, expect, it } from 'vitest';
import { decodeStoredAgentSkillPolicy, encodeAgentSkillPolicy } from './agent-skill-policy';

describe('stored Agent skill policy', () => {
  it('keeps a deliberately empty allowlist distinct from runtime defaults', () => {
    const stored = encodeAgentSkillPolicy({
      enabledSkillIds: [],
      manualSkillIds: [],
      skillPolicyMode: 'allowlist',
    });

    expect(stored).toEqual(['policy:allowlist']);
    expect(decodeStoredAgentSkillPolicy(stored)).toEqual({
      enabledSkillIds: [],
      manualSkillIds: [],
      skillPolicyMode: 'allowlist',
    });
    expect(decodeStoredAgentSkillPolicy([]).skillPolicyMode).toBe('runtime-defaults');
  });

  it('preserves automatic and manual modes while upgrading legacy rows', () => {
    expect(
      decodeStoredAgentSkillPolicy([
        'policy:allowlist',
        'auto:docs',
        'manual:release',
        'legacy-auto',
      ])
    ).toEqual({
      enabledSkillIds: ['docs', 'legacy-auto'],
      manualSkillIds: ['release'],
      skillPolicyMode: 'allowlist',
    });
  });
});
