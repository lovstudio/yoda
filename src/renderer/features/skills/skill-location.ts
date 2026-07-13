import type { CatalogSkill } from '@shared/skills/types';

export type SkillLocationKind =
  | 'yoda'
  | 'project'
  | 'claude'
  | 'claudeCommand'
  | 'claudePluginCache'
  | 'claudePluginMarketplace'
  | 'claudePlugin'
  | 'codex'
  | 'codexPluginCache'
  | 'codexPluginMarketplace'
  | 'codexPlugin'
  | 'agents'
  | 'opencode'
  | 'cursor'
  | 'gemini'
  | 'roo'
  | 'mistral'
  | 'plugin'
  | 'user';

function normalizedPath(path: string): string {
  return path.replace(/\\/g, '/');
}

export function skillLocationKind(skill: CatalogSkill): SkillLocationKind {
  if (skill.scope === 'project') return 'project';
  if (skill.scope === 'managed') return 'yoda';

  const path = normalizedPath(skill.localPath ?? skill.ref.locator).toLocaleLowerCase();
  if (path.includes('/.agentskills/')) return 'yoda';
  if (path.includes('/.claude/plugins/cache/')) return 'claudePluginCache';
  if (path.includes('/.claude/plugins/marketplaces/')) return 'claudePluginMarketplace';
  if (path.includes('/.claude/plugins/')) return 'claudePlugin';
  if (path.includes('/.codex/plugins/cache/')) return 'codexPluginCache';
  if (path.includes('/.codex/.tmp/marketplaces/')) return 'codexPluginMarketplace';
  if (path.includes('/.codex/plugins/')) return 'codexPlugin';
  if (path.includes('/.claude/skills/')) return 'claude';
  if (path.includes('/.claude/commands/')) return 'claudeCommand';
  if (path.includes('/.codex/skills/')) return 'codex';
  if (path.includes('/.agents/skills/') || path.includes('/.agent/skills/')) return 'agents';
  if (path.includes('/.config/opencode/skills/')) return 'opencode';
  if (path.includes('/.cursor/skills/')) return 'cursor';
  if (path.includes('/.gemini/skills/')) return 'gemini';
  if (path.includes('/.roo/skills/')) return 'roo';
  if (path.includes('/.vibe/skills/')) return 'mistral';
  return skill.scope === 'plugin' ? 'plugin' : 'user';
}

const HOME_DIRECTORY_MARKERS = [
  '/.agentskills/',
  '/.claude/',
  '/.codex/',
  '/.agents/',
  '/.agent/',
  '/.config/opencode/',
  '/.cursor/',
  '/.gemini/',
  '/.roo/',
  '/.vibe/',
];

export function compactSkillLocationPath(skill: CatalogSkill): string {
  const path = normalizedPath(skill.localPath ?? skill.ref.locator);
  if (skill.scope === 'project') return path;

  const lowerPath = path.toLocaleLowerCase();
  for (const marker of HOME_DIRECTORY_MARKERS) {
    const index = lowerPath.indexOf(marker);
    if (index > 0) return `~${path.slice(index)}`;
  }
  return path;
}

export function sortSkillLocations(skills: CatalogSkill[]): CatalogSkill[] {
  return [...skills].sort((left, right) => {
    const kindOrder = skillLocationKind(left).localeCompare(skillLocationKind(right));
    return kindOrder || (left.localPath ?? '').localeCompare(right.localPath ?? '');
  });
}
