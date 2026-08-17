import type { RuntimeId } from '@shared/runtime-registry';
import { agentsConfigService } from './agents-config-service';

/**
 * The runtime + model + base prompt an internal AI utility (task naming,
 * session summary, …) should use, resolved from its built-in Agent. Every
 * LLM-backed feature is modeled as an Agent, so its provider/model/prompt are
 * configurable in the Agent Store rather than via bespoke settings.
 */
export interface ResolvedUtilityAgent {
  runtimeId: RuntimeId | null;
  model: string | null;
  systemPrompt: string;
  /** Which Agent won the resolution — recorded in the AI invocation log. */
  agentId: string | null;
  agentName: string | null;
}

/**
 * Resolves the built-in Agent that drives an internal utility (by slug). Returns
 * nulls when the Agent is absent or has no preferred runtime, so callers can
 * fall back to their existing defaults.
 */
export async function resolveUtilityAgent(builtinSlug: string): Promise<ResolvedUtilityAgent> {
  const agent = await agentsConfigService.getBySlug(builtinSlug);
  if (!agent)
    return { runtimeId: null, model: null, systemPrompt: '', agentId: null, agentName: null };
  return {
    runtimeId: agent.preferredRuntime,
    model: agent.model,
    systemPrompt: agent.systemPrompt,
    agentId: agent.id,
    agentName: agent.name,
  };
}

/**
 * Resolves a utility's Agent from a user-selected Agent id, falling back to the
 * built-in preset (by slug) when no id is set or the selected Agent no longer
 * exists. Lets users bind any Agent — runtime, model, and prompt together — to an
 * internal utility while keeping the built-in as a safe default.
 */
export async function resolveSelectedUtilityAgent(
  agentId: string | null | undefined,
  builtinSlug: string
): Promise<ResolvedUtilityAgent> {
  if (agentId) {
    const agent = await agentsConfigService.get(agentId);
    if (agent) {
      return {
        runtimeId: agent.preferredRuntime,
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        agentId: agent.id,
        agentName: agent.name,
      };
    }
  }
  return resolveUtilityAgent(builtinSlug);
}
