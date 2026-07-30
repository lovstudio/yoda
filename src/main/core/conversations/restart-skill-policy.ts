import type { SkillSelectionInput, SkillSessionPolicy } from '@shared/skills/types';

export function skillSelectionForReload(
  policy: SkillSessionPolicy | undefined,
  skillKey: string
): SkillSelectionInput | null {
  if (!policy?.restriction) return null;
  const autoSkillKeys = policy.entries
    .filter((entry) => entry.mode === 'auto')
    .map((entry) => entry.key);
  const manualSkillKeys = policy.entries
    .filter((entry) => entry.mode === 'manual')
    .map((entry) => entry.key);
  if (![...autoSkillKeys, ...manualSkillKeys].includes(skillKey)) autoSkillKeys.push(skillKey);
  return { restriction: 'allowlist', autoSkillKeys, manualSkillKeys };
}
