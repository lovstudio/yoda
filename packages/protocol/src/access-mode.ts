/**
 * Product-level access tier an Agent runs with. The concrete permission mode
 * each tier maps to is client-specific and stays on the desktop connector; the
 * wire protocol only carries the tier.
 */
export const AGENT_ACCESS_MODES = ['inherit', 'plan', 'write', 'full-access'] as const;

export type AgentAccessMode = (typeof AGENT_ACCESS_MODES)[number];

export function isAgentAccessMode(value: unknown): value is AgentAccessMode {
  return AGENT_ACCESS_MODES.includes(value as AgentAccessMode);
}
