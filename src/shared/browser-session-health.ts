export const BROWSER_SESSION_HEALTH_TASK_SPACE_NAME = 'Yoda 会话保活' as const;

export const BROWSER_SESSION_HEALTH_CONFIG_VERSION = 1 as const;

export type BrowserSessionHealthOwnership = 'agent' | 'agentDelegatedToUser' | 'user' | 'unknown';

export type BrowserSessionHealthTargetState =
  | 'unknown'
  | 'checking'
  | 'fresh'
  | 'auth_required'
  | 'needs_human'
  | 'waiting_user'
  | 'network_error'
  | 'error';

export type BrowserSessionHealthAttentionState = Extract<
  BrowserSessionHealthTargetState,
  'auth_required' | 'needs_human'
>;

export type BrowserSessionHealthEgoStatus =
  | 'unknown'
  | 'connected'
  | 'not_running'
  | 'waiting_user'
  | 'error';

export interface BrowserSessionHealthTarget {
  id: string;
  name: string;
  /** A sanitized HTTPS origin + pathname. Probes always navigate with GET semantics. */
  url: string;
  enabled: boolean;
  intervalMinutes: number;
  loginUrlPatterns: string[];
  loginTitlePatterns: string[];
  humanUrlPatterns: string[];
  humanTitlePatterns: string[];
}

export interface BrowserSessionHealthTargetInput {
  id?: string;
  name: string;
  url: string;
  enabled?: boolean;
  intervalMinutes?: number;
  loginUrlPatterns?: string[];
  loginTitlePatterns?: string[];
  humanUrlPatterns?: string[];
  humanTitlePatterns?: string[];
  /** Compatibility fields for a compact one-marker UI. */
  loginUrlMarker?: string;
  loginTitleMarker?: string;
}

export interface BrowserSessionHealthConfig {
  version: typeof BROWSER_SESSION_HEALTH_CONFIG_VERSION;
  enabled: boolean;
  targets: BrowserSessionHealthTarget[];
}

export interface BrowserSessionHealthDiagnostic {
  code:
    | 'ego_not_running'
    | 'command_timeout'
    | 'command_failed'
    | 'invalid_response'
    | 'navigation_failed'
    | 'handoff_failed'
    | 'resume_failed'
    | 'ownership_changed'
    | 'store_error'
    | 'unknown_error';
  message: string;
  operation: 'initialize' | 'probe' | 'handoff' | 'resume' | 'store';
  at: string;
  retryable: boolean;
}

/**
 * Persisted evidence. URLs are always origin + pathname, and raw page titles,
 * response bodies, queries, fragments, cookies, and tokens are never stored.
 */
export interface BrowserSessionHealthTargetStatus {
  targetId: string;
  state: BrowserSessionHealthTargetState;
  checkedAt: string | null;
  stateChangedAt: string | null;
  lastFreshAt: string | null;
  consecutiveFresh: number;
  nextCheckAt: string | null;
  finalUrl: string | null;
  handoffUrl: string | null;
  ownership: BrowserSessionHealthOwnership;
  taskSpaceId: number | null;
  error: BrowserSessionHealthDiagnostic | null;
}

export interface BrowserSessionHealthPersistedState {
  version: typeof BROWSER_SESSION_HEALTH_CONFIG_VERSION;
  statuses: Record<string, BrowserSessionHealthTargetStatus>;
}

export interface BrowserSessionHealthAttention {
  targetId: string;
  targetName: string;
  state: BrowserSessionHealthAttentionState;
  title: string;
  message: string;
  at: string;
  handoffUrl: string | null;
}

export interface BrowserSessionHealthTargetSnapshot extends BrowserSessionHealthTarget {
  status: BrowserSessionHealthTargetState;
  lastCheckedAt: string | null;
  consecutiveHealthyChecks: number;
  lastFreshAt: string | null;
  nextCheckAt: string | null;
  lastError: BrowserSessionHealthDiagnostic | null;
  finalUrl: string | null;
  handoffUrl: string | null;
  ownership: BrowserSessionHealthOwnership;
  taskSpaceId: number | null;
}

export interface BrowserSessionHealthSnapshot {
  config: BrowserSessionHealthConfig;
  targets: BrowserSessionHealthTargetSnapshot[];
  statuses: Record<string, BrowserSessionHealthTargetStatus>;
  attention: BrowserSessionHealthAttention | null;
  connected: boolean;
  egoStatus: BrowserSessionHealthEgoStatus;
  taskSpaceName: typeof BROWSER_SESSION_HEALTH_TASK_SPACE_NAME;
  taskSpaceId: number | null;
  ownership: BrowserSessionHealthOwnership;
  checkedAt: string | null;
}
