import type { MobileSkillSummary } from '@shared/mobile-api';
import { selectSkillFamilyRepresentatives } from '@shared/skills/grouping';
import type { CatalogIndex } from '@shared/skills/types';

/** Match the desktop composer: installed, enabled, one representative per Skill family. */
export function mobileSkillSummaries(
  catalog: CatalogIndex,
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
    }));
}
