import type { AgentAccessMode } from '@lovstudio/yoda-protocol/access-mode';
import {
  getRuntimePermissionModes,
  type RuntimeId,
  type RuntimePermissionMode,
} from './runtime-registry';

export type AgentSkillPolicyMode = 'runtime-defaults' | 'allowlist';

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
   * `runtime-defaults` leaves skill discovery to the selected client.
   * `allowlist` exposes only the configured automatic/manual skills; an empty
   * allowlist intentionally exposes no standalone skills.
   */
  skillPolicyMode: AgentSkillPolicyMode;
  /**
   * Preferred Agent Runtime. At execution time we use this runtime when it is
   * available/supported, otherwise we fall back to the run-mode default.
   */
  preferredRuntime: RuntimeId | null;
  /** Optional model hint (e.g. 'claude-opus-4-8'); null = runtime default. */
  model: string | null;
  /**
   * Optional suffix appended to `model` verbatim (e.g. '[1m]'), decoupled from
   * the model list so a suffixed variant doesn't need its own catalog entry.
   * null = no suffix.
   */
  modelSuffix: string | null;
  /** Optional client-specific reasoning depth; null = inherit the client default. */
  reasoningEffort: string | null;
  /** Product-level access tier, mapped to the selected client's native permission mode. */
  accessMode: AgentAccessMode;
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
  skillPolicyMode: AgentSkillPolicyMode;
  preferredRuntime: RuntimeId | null;
  model: string | null;
  modelSuffix: string | null;
  reasoningEffort: string | null;
  accessMode: AgentAccessMode;
}

export const DEFAULT_AGENT_ICON = '🤖';

export function emptyAgentDraft(): AgentDraft {
  return {
    name: '',
    description: '',
    icon: '',
    systemPrompt: '',
    enabledSkillIds: [],
    manualSkillIds: [],
    skillPolicyMode: 'runtime-defaults',
    preferredRuntime: null,
    model: null,
    modelSuffix: null,
    reasoningEffort: null,
    accessMode: 'inherit',
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
    skillPolicyMode: agent.skillPolicyMode,
    preferredRuntime: agent.preferredRuntime,
    model: agent.model,
    modelSuffix: agent.modelSuffix,
    reasoningEffort: agent.reasoningEffort,
    accessMode: agent.accessMode,
  };
}

/**
 * The model actually sent to the runtime for this Agent: `model` with
 * `modelSuffix` appended verbatim (no separator), falling back to null when no
 * base model is set. This is the single place a suffix is applied.
 */
export function resolveAgentModel(agent: Agent | null | undefined): string | null {
  const model = agent?.model;
  if (!model) return null;
  const suffix = agent?.modelSuffix?.trim();
  return suffix ? `${model}${suffix}` : model;
}

/**
 * Convert the reusable Agent access tier into the concrete permission mode
 * exposed by a runtime. Unsupported intermediate tiers degrade to the
 * runtime's normal mode; full access is selected only when a danger tier is
 * explicitly available.
 */
export function resolveAgentPermissionMode(
  runtimeId: RuntimeId,
  accessMode: AgentAccessMode
): string | undefined {
  if (accessMode === 'inherit') return undefined;
  const modes = getRuntimePermissionModes(runtimeId);
  const preferredIds: Record<Exclude<AgentAccessMode, 'inherit'>, string[]> = {
    plan: ['plan'],
    write: ['accept-edits', 'full-auto', 'default'],
    'full-access': [],
  };
  if (accessMode === 'full-access') {
    return modes.find((mode) => mode.danger)?.id;
  }
  return findPermissionMode(modes, preferredIds[accessMode])?.id ?? modes[0]?.id;
}

function findPermissionMode(
  modes: readonly RuntimePermissionMode[],
  preferredIds: readonly string[]
): RuntimePermissionMode | undefined {
  for (const id of preferredIds) {
    const match = modes.find((mode) => mode.id === id);
    if (match) return match;
  }
  return undefined;
}
