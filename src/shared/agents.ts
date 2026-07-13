import type { RuntimeId } from './runtime-registry';

/**
 * A user-configurable Agent: a reusable bundle of a system prompt, a set of
 * enabled skills, and an optional preferred runtime/model. This is distinct
 * from an "Agent Runtime" (Claude Code, Codex, …) which is the execution
 * environment an Agent runs on.
 *
 * The shape is intentionally market-ready: `source` and `slug` leave room for
 * a future "Agent market" (browse / install / import-export) without a schema
 * change.
 */
export interface Agent {
  id: string;
  /** Stable human-facing handle, unique per install. Reserved for sharing. */
  slug: string;
  name: string;
  description: string;
  /** Emoji/glyph, image URL, or data URL used as the card avatar. */
  icon: string;
  systemPrompt: string;
  /** Stable skill keys this agent enables for implicit routing when it runs. */
  enabledSkillIds: string[];
  /** Skills exposed for explicit invocation but hidden from implicit routing. */
  manualSkillIds: string[];
  /**
   * Preferred Agent Runtime. At execution time we use this runtime when it is
   * available/supported, otherwise we fall back to the run-mode default.
   */
  preferredRuntime: RuntimeId | null;
  /** Optional model hint (e.g. 'claude-opus-4-8'); null = runtime default. */
  model: string | null;
  /** 'local' = authored here; 'imported' = brought in from a share/market. */
  source: AgentSource;
  createdAt: string;
  updatedAt: string;
}

export type AgentSource = 'local' | 'imported';

/** Fields a user can set when creating/updating an agent. */
export interface AgentDraft {
  name: string;
  description: string;
  icon: string;
  systemPrompt: string;
  enabledSkillIds: string[];
  manualSkillIds: string[];
  preferredRuntime: RuntimeId | null;
  model: string | null;
}

export const DEFAULT_AGENT_ICON = '🤖';

export function emptyAgentDraft(): AgentDraft {
  return {
    name: '',
    description: '',
    icon: DEFAULT_AGENT_ICON,
    systemPrompt: '',
    enabledSkillIds: [],
    manualSkillIds: [],
    preferredRuntime: null,
    model: null,
  };
}

export function agentToDraft(agent: Agent): AgentDraft {
  return {
    name: agent.name,
    description: agent.description,
    icon: agent.icon,
    systemPrompt: agent.systemPrompt,
    enabledSkillIds: [...agent.enabledSkillIds],
    manualSkillIds: [...agent.manualSkillIds],
    preferredRuntime: agent.preferredRuntime,
    model: agent.model,
  };
}
