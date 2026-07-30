export const AGENT_REPLY_DISPLAY_LEVELS = ['hidden', 'concise', 'detailed', 'verbose'] as const;

export type AgentReplyDisplayLevel = (typeof AGENT_REPLY_DISPLAY_LEVELS)[number];

export function isAgentReplyDisplayLevel(value: unknown): value is AgentReplyDisplayLevel {
  return AGENT_REPLY_DISPLAY_LEVELS.includes(value as AgentReplyDisplayLevel);
}
