import os from 'node:os';
import { createRPCController } from '@/shared/ipc/rpc';
import type { SkillTriggerQuery } from '@shared/skills/types';
import { getSkillUsageStats } from '@main/core/skills/getUsageStats';
import { skillsService } from '@main/core/skills/SkillsService';
import { cancelSkillTriggerRuns, runSkillTriggerQuery } from '@main/core/skills/trigger-test';
import { requestUtilityAgentJson } from '@main/core/tasks/name-generation/task-naming-service';
import { log } from '@main/lib/logger';

function parseTriggerQueries(raw: unknown): SkillTriggerQuery[] {
  if (!Array.isArray(raw)) return [];
  const queries: SkillTriggerQuery[] = [];
  for (const entry of raw) {
    const candidate = entry as { text?: unknown; shouldTrigger?: unknown };
    if (typeof candidate.text !== 'string' || !candidate.text.trim()) continue;
    queries.push({
      text: candidate.text.trim(),
      shouldTrigger: candidate.shouldTrigger !== false,
    });
  }
  return queries;
}

export const skillsController = createRPCController({
  getCatalog: async (args?: { projectPath?: string }) => {
    try {
      const catalog = await skillsService.getCatalogIndex(args?.projectPath);
      return { success: true, data: catalog };
    } catch (error) {
      log.error('Failed to get skills catalog:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  refreshCatalog: async () => {
    try {
      const catalog = await skillsService.refreshCatalog();
      return { success: true, data: catalog };
    } catch (error) {
      log.error('Failed to refresh skills catalog:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  install: async (args: { skillId: string }) => {
    try {
      const skill = await skillsService.installSkill(args.skillId);
      return { success: true, data: skill };
    } catch (error) {
      log.error('Failed to install skill:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  uninstall: async (args: { skillId: string }) => {
    try {
      await skillsService.uninstallSkill(args.skillId);
      return { success: true };
    } catch (error) {
      log.error('Failed to uninstall skill:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  setDisabled: async (args: { skillId: string; disabled: boolean }) => {
    try {
      const skill = await skillsService.setSkillDisabled(args.skillId, args.disabled);
      return { success: true, data: skill };
    } catch (error) {
      log.error('Failed to update skill disabled state:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  getDetail: async (args: { skillId: string }) => {
    try {
      const skill = await skillsService.getSkillDetail(args.skillId);
      return { success: true, data: skill };
    } catch (error) {
      log.error('Failed to get skill detail:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  getDetectedAgents: async () => {
    try {
      const agents = await skillsService.getDetectedAgents();
      return { success: true, data: agents };
    } catch (error) {
      log.error('Failed to detect agents:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  getUsageStats: async (args?: { refresh?: boolean }) => {
    try {
      const stats = await getSkillUsageStats(args?.refresh);
      return { success: true, data: stats };
    } catch (error) {
      // Expected when the skillusage CLI is not installed; the UI degrades.
      log.warn('Failed to get skill usage stats:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  tryTriggerQuery: async (args: { skillId: string; query: string }) => {
    try {
      const skill = await skillsService.getSkillDetail(args.skillId);
      const skillNames = [skill.id, skill.frontmatter.name].filter(Boolean);
      const result = await runSkillTriggerQuery({ query: args.query, skillNames });
      return { success: true, data: result };
    } catch (error) {
      log.error('Failed to run skill trigger query:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  cancelTriggerTest: async () => {
    cancelSkillTriggerRuns();
    return { success: true };
  },

  generateTriggerQueries: async (args: { skillId: string }) => {
    try {
      const skill = await skillsService.getSkillDetail(args.skillId);
      const prompt = [
        'You design trigger tests for an agent skill. A trigger test checks whether',
        'a coding agent invokes the skill for a given user query.',
        'Return strict JSON only. Do not include markdown, code fences, or explanations.',
        'Rules:',
        '- Produce exactly 3 queries that SHOULD trigger the skill: realistic user requests,',
        '  varied phrasing, written in the same language as the skill description.',
        '- Produce exactly 2 queries that should NOT trigger it: adjacent but out-of-scope',
        '  requests that a careless description would wrongly match.',
        '- Keep each query under 120 characters.',
        'JSON schema: {"queries":[{"text":"...","shouldTrigger":true}]}',
        '',
        `Skill name: ${skill.frontmatter.name || skill.id}`,
        `Skill description: ${skill.description}`,
      ].join('\n');
      const payload = await requestUtilityAgentJson({ prompt, cwd: os.homedir() });
      const queries = parseTriggerQueries(payload.queries);
      if (queries.length === 0) throw new Error('Model returned no trigger queries.');
      return { success: true, data: queries };
    } catch (error) {
      log.error('Failed to generate trigger queries:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  create: async (args: { name: string; description: string; content?: string }) => {
    try {
      const skill = await skillsService.createSkill(args.name, args.description, args.content);
      return { success: true, data: skill };
    } catch (error) {
      log.error('Failed to create skill:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
