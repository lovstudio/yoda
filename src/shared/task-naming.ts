export const TASK_NAMING_CONTEXT_SOURCE_IDS = [
  'prompt',
  'project',
  'readme',
  'recentTasks',
] as const;

export type TaskNamingContextSourceId = (typeof TASK_NAMING_CONTEXT_SOURCE_IDS)[number];

export type TaskNamingLanguage = 'skip' | 'app' | 'prompt' | 'en' | 'zh-CN';

export type TaskNamingContextSettings = Record<TaskNamingContextSourceId, boolean>;

export type TaskNamingSettings = {
  model: string;
  language: TaskNamingLanguage;
  context: TaskNamingContextSettings;
  recentTaskLimit: number;
  requestTimeoutMs: number;
};

export const DEFAULT_TASK_NAMING_MODEL = '';
export const DEFAULT_TASK_NAMING_RECENT_TASK_LIMIT = 8;
export const MIN_TASK_NAMING_TIMEOUT_MS = 30_000;
export const MAX_TASK_NAMING_TIMEOUT_MS = 300_000;
export const DEFAULT_TASK_NAMING_TIMEOUT_MS = 60_000;

export function normalizeTaskNamingTimeoutMs(value: number | null | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_TASK_NAMING_TIMEOUT_MS;
  return Math.min(
    MAX_TASK_NAMING_TIMEOUT_MS,
    Math.max(MIN_TASK_NAMING_TIMEOUT_MS, Math.round(value as number))
  );
}

export const DEFAULT_TASK_NAMING_CONTEXT: TaskNamingContextSettings = {
  prompt: true,
  project: true,
  readme: true,
  recentTasks: true,
};

export type TaskNamingStatus = 'idle' | 'generating' | 'ready' | 'failed' | 'skipped';

export type TaskNamingContextSource = {
  id: string;
  label: string;
  content: string;
  estimatedTokens: number;
  truncated?: boolean;
};

export type TaskNamingDebugStage = {
  name: string;
  durationMs: number;
  metadata?: Record<string, string | number | boolean | null>;
};

export type TaskNamingDebugTrace = {
  totalDurationMs: number;
  stages: TaskNamingDebugStage[];
};

export type TaskNamingContextSnapshot = {
  version: 1;
  taskId: string;
  projectId: string;
  createdAt: string;
  language: TaskNamingLanguage;
  model: string;
  estimatedTokens: number;
  estimatedCharacters: number;
  sourceCount: number;
  generationMethod?: 'agent-cli' | 'maas-chat';
  debugTrace?: TaskNamingDebugTrace;
  sources: TaskNamingContextSource[];
};

export type TaskNamingSnapshot = {
  taskId: string;
  projectId: string;
  status: TaskNamingStatus;
  model: string | null;
  context: TaskNamingContextSnapshot | null;
  generatedTaskName?: string;
  generatedBranchName?: string;
  /**
   * The system + final prompt actually assembled and sent to the naming agent.
   * Backend-authored (not the runtime's own prompt), so it is exposed for
   * preview/debugging. Ephemeral — not persisted to the DB, only present on the
   * live snapshot returned/emitted during generation.
   */
  systemPrompt?: string;
  systemPromptEstimatedTokens?: number;
  prompt?: string;
  promptChars?: number;
  promptEstimatedTokens?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
};
