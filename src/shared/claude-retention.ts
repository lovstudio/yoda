export const CLAUDE_DEFAULT_CLEANUP_PERIOD_DAYS = 30;
export const CLAUDE_RECOMMENDED_CLEANUP_PERIOD_DAYS = 3650;

export type ClaudeRetentionSettings = {
  cleanupPeriodDays: number | null;
  effectiveCleanupPeriodDays: number;
  configured: boolean;
};
