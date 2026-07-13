import * as path from 'node:path';
import type { SkillSessionPolicy } from '@shared/skills/types';

export type ClaudeSkillOverride = 'on' | 'user-invocable-only' | 'off';

export function buildClaudeSkillOverrides(
  policy: SkillSessionPolicy
): Record<string, ClaudeSkillOverride> {
  const overrides: Record<string, ClaudeSkillOverride> = {};
  for (const skill of policy.available) {
    if (skill.scope !== 'plugin') overrides[skill.id] = 'off';
  }
  for (const entry of policy.entries) {
    if (entry.scope === 'plugin') continue;
    const next: ClaudeSkillOverride = entry.mode === 'auto' ? 'on' : 'user-invocable-only';
    // Name-based runtimes cannot separate colliding paths. Prefer auto over
    // manual so an explicit automatic selection is never silently weakened.
    if (overrides[entry.id] !== 'on') overrides[entry.id] = next;
  }
  return overrides;
}

function tomlInlineString(value: string): string {
  return JSON.stringify(value);
}

/** Value consumed by Codex's `-c skills.config=<TOML array>` override. */
export function buildCodexSkillConfig(policy: SkillSessionPolicy): string {
  const enabledPaths = new Set(policy.entries.map((entry) => path.resolve(entry.path)));
  return `[${policy.available
    .filter((skill) => skill.scope !== 'plugin')
    .map((skill) => {
      const skillFile = path.join(skill.path, 'SKILL.md');
      return `{path=${tomlInlineString(skillFile)},enabled=${enabledPaths.has(path.resolve(skill.path))}}`;
    })
    .join(',')}]`;
}
