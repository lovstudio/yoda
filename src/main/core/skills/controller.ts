import os from 'node:os';
import path from 'node:path';
import { createRPCController } from '@/shared/ipc/rpc';
import type { SkillEvaluationCase, SkillTriggerQuery } from '@shared/skills/types';
import { getResolvedHarnessSnapshot } from '@main/core/skills/get-resolved-harness-snapshot';
import { getSkillUsageStats } from '@main/core/skills/getUsageStats';
import { SkillEvaluationStore } from '@main/core/skills/skill-evaluation-store';
import { routeSkills } from '@main/core/skills/skill-router';
import { skillsService } from '@main/core/skills/SkillsService';
import { cancelSkillTriggerRuns, runSkillTriggerQuery } from '@main/core/skills/trigger-test';
import { requestUtilityAgentJson } from '@main/core/tasks/name-generation/task-naming-service';
import { log } from '@main/lib/logger';

function ensureTrailingNewline(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`;
}

const evaluationStore = new SkillEvaluationStore(
  path.join(os.homedir(), '.agentskills', '.yoda', 'evaluations.json')
);

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

  getHarnessSnapshot: async (args: { projectId: string }) => {
    try {
      return { success: true, data: await getResolvedHarnessSnapshot(args.projectId) };
    } catch (error) {
      log.error('Failed to resolve project harness snapshot:', error);
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

  install: async (args: { skillKey: string }) => {
    try {
      const skill = await skillsService.installSkill(args.skillKey);
      return { success: true, data: skill };
    } catch (error) {
      log.error('Failed to install skill:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  uninstall: async (args: { skillKey: string }) => {
    try {
      await skillsService.uninstallSkill(args.skillKey);
      return { success: true };
    } catch (error) {
      log.error('Failed to uninstall skill:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  setDisabled: async (args: { skillKey: string; disabled: boolean }) => {
    try {
      const skill = await skillsService.setSkillDisabled(args.skillKey, args.disabled);
      return { success: true, data: skill };
    } catch (error) {
      log.error('Failed to update skill disabled state:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  getDetail: async (args: { skillKey: string }) => {
    try {
      const skill = await skillsService.getSkillDetail(args.skillKey);
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

  getFiles: async (args: { skillKey: string }) => {
    try {
      return { success: true, data: await skillsService.getSkillFiles(args.skillKey) };
    } catch (error) {
      log.error('Failed to get skill files:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  route: async (args: {
    query: string;
    projectPath?: string;
    allowedSkillKeys?: string[];
    limit?: number;
  }) => {
    try {
      const catalog = await skillsService.getCatalogIndex(args.projectPath);
      return {
        success: true,
        data: routeSkills({
          query: args.query,
          skills: catalog.skills,
          allowedSkillKeys: args.allowedSkillKeys ? new Set(args.allowedSkillKeys) : undefined,
          limit: args.limit,
        }),
      };
    } catch (error) {
      log.error('Failed to route skills:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  getEvaluation: async (args: { skillKey: string }) => {
    try {
      return { success: true, data: await evaluationStore.get(args.skillKey) };
    } catch (error) {
      log.error('Failed to load skill evaluation:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  saveEvaluationCases: async (args: { skillKey: string; cases: SkillEvaluationCase[] }) => {
    try {
      await evaluationStore.saveCases(args.skillKey, args.cases);
      return { success: true };
    } catch (error) {
      log.error('Failed to save skill evaluation cases:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  markReviewed: async (args: { skillKey: string }) => {
    try {
      return { success: true, data: await skillsService.markSkillReviewed(args.skillKey) };
    } catch (error) {
      log.error('Failed to mark skill as reviewed:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  tryTriggerQuery: async (args: {
    skillKey: string;
    caseId: string;
    query: string;
    shouldTrigger: boolean;
  }) => {
    try {
      const skill = await skillsService.getSkillDetail(args.skillKey);
      if (!skill) throw new Error(`Skill not found: ${args.skillKey}`);
      const skillNames = [skill.id, skill.frontmatter.name].filter(Boolean);
      const result = await runSkillTriggerQuery({ query: args.query, skillNames });
      const passed = args.shouldTrigger
        ? result.status === 'triggered'
        : result.status === 'not-triggered' || result.status === 'other-skill';
      await evaluationStore.recordResult(skill.key, {
        caseId: args.caseId,
        result,
        passed,
        runtime: 'claude',
        contentHash: skill.contentHash,
        runAt: new Date().toISOString(),
      });
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

  generateTriggerQueries: async (args: { skillKey: string }) => {
    try {
      const skill = await skillsService.getSkillDetail(args.skillKey);
      if (!skill) throw new Error(`Skill not found: ${args.skillKey}`);
      const prompt = [
        'You design trigger tests for an agent skill. A trigger test checks whether',
        'a coding agent invokes the skill for a given user query.',
        'Return strict JSON only. Do not include markdown, code fences, or explanations.',
        'Rules:',
        '- Produce exactly 3 queries that SHOULD trigger the skill: realistic user requests,',
        '  varied phrasing, written in the same language as the skill description.',
        '- Produce exactly 3 queries that should NOT trigger it: two difficult nearest-neighbor',
        '  requests plus one request for which no skill should be selected. These should expose',
        '  overly broad descriptions instead of being obviously unrelated.',
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

  /** AI-revise a skill's SKILL.md per a user instruction. Returns the proposal; nothing is written. */
  revise: async (args: { skillKey: string; instruction: string }) => {
    try {
      const skill = await skillsService.getSkillDetail(args.skillKey);
      if (!skill?.skillMdContent) throw new Error(`Skill content unavailable: ${args.skillKey}`);
      const prompt = [
        'You revise an agent skill definition (a SKILL.md file with YAML frontmatter).',
        'Apply the user instruction to the file. Keep everything the instruction does not',
        'ask to change byte-identical, including the frontmatter structure and field order.',
        'Never change the name field. Keep the description a single frontmatter scalar.',
        'Return strict JSON only. Do not include markdown fences or explanations.',
        'JSON schema: {"content":"<the full revised SKILL.md>"}',
        '',
        `User instruction: ${args.instruction}`,
        '',
        'Current SKILL.md:',
        skill.skillMdContent,
      ].join('\n');
      const payload = await requestUtilityAgentJson({ prompt, cwd: os.homedir() });
      const content = typeof payload.content === 'string' ? payload.content : '';
      if (!content.trim()) throw new Error('Model returned no revised content.');
      return {
        success: true,
        data: { original: skill.skillMdContent, revised: ensureTrailingNewline(content) },
      };
    } catch (error) {
      log.error('Failed to revise skill:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  updateContent: async (args: { skillKey: string; content: string }) => {
    try {
      const skill = await skillsService.updateSkillContent(args.skillKey, args.content);
      return { success: true, data: skill };
    } catch (error) {
      log.error('Failed to update skill content:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  duplicate: async (args: { skillKey: string; newName: string }) => {
    try {
      const skill = await skillsService.duplicateSkill(args.skillKey, args.newName);
      return { success: true, data: skill };
    } catch (error) {
      log.error('Failed to duplicate skill:', error);
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
