import { resolveAgentPermissionMode, type Agent } from '@shared/agents';
import { withSystemPrompt } from '@shared/prompt-format';
import type { RuntimeId } from '@shared/runtime-registry';
import { normalizeSkillSelection } from '@shared/skills/selection';
import type { SkillSelectionInput } from '@shared/skills/types';

/** The Agent's skill policy, in the shape `createConversation` accepts. */
export function agentSkillSelection(agent: Agent | null): SkillSelectionInput | undefined {
  if (!agent) return undefined;
  return normalizeSkillSelection({
    restriction: agent.skillPolicyMode === 'allowlist' ? 'allowlist' : undefined,
    autoSkillKeys: agent.enabledSkillIds,
    manualSkillKeys: agent.manualSkillIds,
  });
}

/** The Agent's model, effort, and access policy for the runtime it runs on. */
export function agentRuntimeSettings(agent: Agent | null, runtimeId: RuntimeId) {
  return {
    agent: agent
      ? {
          id: agent.id,
          name: agent.name,
          icon: agent.icon,
        }
      : undefined,
    model: agent?.model,
    reasoningEffort: runtimeId === 'codex' ? agent?.reasoningEffort : undefined,
    permissionMode: agent ? resolveAgentPermissionMode(runtimeId, agent.accessMode) : undefined,
  };
}

/** The default framing: the Agent's system prompt above the user's requirement. */
export function buildRequirementPrompt(args: {
  requirement: string;
  systemPrompt: string;
}): string {
  return withSystemPrompt(
    args.systemPrompt,
    [`User requirement:`, args.requirement || '(No explicit requirement was provided.)'].join('\n')
  );
}

/**
 * The standard prompt shape: the Agent's system prompt above the requirement, or
 * the bare requirement when the Agent contributes no system prompt. Returned as
 * a builder because a deferred prompt is rebuilt from the rewritten requirement.
 */
export function requirementPromptBuilder(
  systemPrompt: string
): (requirement: string) => string | undefined {
  const framing = systemPrompt.trim();
  return (requirement) =>
    framing
      ? buildRequirementPrompt({ requirement, systemPrompt: framing })
      : requirement || undefined;
}
