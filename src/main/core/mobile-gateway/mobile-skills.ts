import type { MobileSkillSummary } from '@lovstudio/yoda-protocol/mobile-api';
import { applyAgentCommandPrefix } from '@shared/agent-command-prefix';
import type { RuntimeId } from '@shared/runtime-registry';
import { selectSkillFamilyRepresentatives } from '@shared/skills/grouping';
import type { CatalogIndex } from '@shared/skills/types';

/**
 * Match the desktop composer: installed, enabled, one representative per Skill
 * family. `insertText` is resolved here so the phone never needs the runtime
 * registry to know how a client spells command invocations.
 */
export function mobileSkillSummaries(
  catalog: CatalogIndex,
  runtimeId: RuntimeId,
  allowedSkillKeys: ReadonlySet<string> | null = null
): MobileSkillSummary[] {
  return selectSkillFamilyRepresentatives(
    catalog.skills.filter(
      (skill) =>
        skill.installed &&
        !skill.disabled &&
        (!allowedSkillKeys ||
          skill.scope === 'plugin' ||
          allowedSkillKeys.has(skill.key) ||
          allowedSkillKeys.has(skill.id))
    ),
    { preferredKeys: allowedSkillKeys ?? undefined }
  )
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
    .map((skill) => ({
      key: skill.key,
      id: skill.id,
      displayName: skill.displayName,
      description: skill.description,
      insertText: applyAgentCommandPrefix(runtimeId, skill.id),
    }));
}
