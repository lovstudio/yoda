import type { CatalogSkill, SkillHealthIssue } from '@shared/skills/types';

const SEVERITY_ORDER: Record<SkillHealthIssue['severity'], number> = {
  error: 3,
  warning: 2,
  info: 1,
};

export function primarySkillHealthIssue(skill: CatalogSkill): SkillHealthIssue | undefined {
  return [...(skill.healthIssues ?? [])].sort(
    (left, right) => SEVERITY_ORDER[right.severity] - SEVERITY_ORDER[left.severity]
  )[0];
}

export function skillNeedsAttention(skill: CatalogSkill): boolean {
  if (!skill.installed) return false;
  if (skill.riskLevel === 'high') return true;
  if (skill.dependencies?.some((dependency) => dependency.available === false)) return true;
  return (skill.healthIssues ?? []).some(
    (issue) => issue.severity === 'warning' || issue.severity === 'error'
  );
}
