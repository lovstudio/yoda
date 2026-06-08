import type { AgentProviderId } from './agent-provider-registry';

/** Where a hook definition was read from. */
export type HookSource =
  | 'user' // ~/.claude/settings.json or ~/.codex/config.toml
  | 'project' // <cwd>/.claude/settings.json
  | 'local' // <cwd>/.claude/settings.local.json
  | 'codex'; // codex notify entry

export interface InspectedHook {
  /** Stable id within a provider/cwd: `${source}:${event}:${matcher}:${index}`. */
  id: string;
  /** Hook event key, e.g. 'PreToolUse', 'PostToolUse', 'Notification', 'Stop'. */
  event: string;
  /** Tool/event matcher pattern, when applicable. */
  matcher?: string;
  /** The shell command that runs. */
  command: string;
  source: HookSource;
  /** Absolute path of the settings file this hook was read from. */
  sourcePath: string;
  /** True for entries Yoda itself injected (the notification/stop curl). */
  managedByYoda: boolean;
  /** Effective enabled state after applying the task's override layer. */
  enabled: boolean;
}

export interface HookInspectionResult {
  providerId: AgentProviderId;
  supported: boolean;
  /** Absolute paths that were read (existing ones only). */
  sources: string[];
  hooks: InspectedHook[];
}

export interface TaskHookOverrides {
  /** Hook ids explicitly disabled for this task. */
  disabled: string[];
  /** When true, hook commands are wrapped with a logging shim on next session start. */
  debug: boolean;
}

export const EMPTY_TASK_HOOK_OVERRIDES: TaskHookOverrides = { disabled: [], debug: false };
