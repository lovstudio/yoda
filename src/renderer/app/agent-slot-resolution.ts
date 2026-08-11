import type { Agent } from '@shared/agents';
import type { RuntimeId } from '@shared/runtime-registry';

export type ResolvedAgentSlot = {
  provider: RuntimeId | null;
  systemPrompt: string;
  agent: Agent | null;
};

/**
 * A slot assigns one Agent. Its runtime, prompt, model, skills, and access
 * policy belong to that Agent; the fallback only supports Agents intentionally
 * configured to follow the run-mode default runtime.
 */
export function resolveAgentSlot({
  selectedAgentId,
  agents,
  fallbackRuntime,
}: {
  selectedAgentId: string | null;
  agents: Agent[];
  fallbackRuntime: RuntimeId | null;
}): ResolvedAgentSlot {
  const agent = selectedAgentId
    ? (agents.find((candidate) => candidate.id === selectedAgentId) ?? null)
    : null;
  if (!agent) return { provider: null, systemPrompt: '', agent: null };

  return {
    provider: agent.preferredRuntime ?? fallbackRuntime,
    systemPrompt: agent.systemPrompt,
    agent,
  };
}
