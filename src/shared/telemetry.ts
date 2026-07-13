import type { MaasPlatformId } from '@shared/maas';
import type { OpenInAppId } from '@shared/openInApps';
import type { RuntimeId } from '@shared/runtime-registry';
import type { TaskLifecycleStatus } from '@shared/tasks';

type EmptyProps = Record<string, never>;

export type FocusView =
  | 'home'
  | 'project'
  | 'projectless'
  | 'task'
  | 'file'
  | 'settings'
  | 'skills'
  | 'skill'
  | 'skillCompare'
  | 'mcp'
  | 'agentManager'
  | 'agents'
  | 'maas'
  | 'aiLab'
  | 'automation'
  | 'mobile'
  | 'usage'
  | 'roadmap'
  | 'kanban'
  | 'projectsOverview'
  | 'library';
export type FocusMainPanel = 'agents' | 'editor' | 'diff';
export type FocusedRegion = 'main' | 'bottom';

export type FocusTrigger = 'navigation' | 'panel_switch' | 'region_switch';

export interface TelemetryEnvelope {
  event_ts_ms?: number;
  session_id?: string;
  project_id?: string;
  task_id?: string;
  conversation_id?: string;
}

export interface FocusContext {
  active_view: FocusView | null;
  active_main_panel: FocusMainPanel | null;
  focused_region: FocusedRegion | null;
}

export type SettingName = 'theme' | 'default_provider' | 'telemetry' | 'notifications';

export type TelemetryEventProperties = {
  app_started: EmptyProps;
  app_closed: { was_crash?: boolean };
  app_window_focused: EmptyProps;
  app_window_unfocused: EmptyProps;
  daily_active_user: { date: string; timezone: string };

  focus_changed: {
    view: FocusView | null;
    main_panel: FocusMainPanel | null;
    focused_region: FocusedRegion | null;
    trigger: FocusTrigger;
  };

  home_viewed: { from_view: FocusView | null };
  project_viewed: { from_view: FocusView | null };
  projectless_viewed: { from_view: FocusView | null };
  task_viewed: { from_view: FocusView | null };
  file_viewed: { from_view: FocusView | null };
  settings_viewed: { from_view: FocusView | null };
  skills_viewed: { from_view: FocusView | null };
  mcp_viewed: { from_view: FocusView | null };
  agents_viewed: { from_view: FocusView | null };
  maas_viewed: { from_view: FocusView | null };
  ai_lab_viewed: { from_view: FocusView | null };
  usage_viewed: { from_view: FocusView | null };
  roadmap_viewed: { from_view: FocusView | null };
  kanban_viewed: { from_view: FocusView | null };
  automation_viewed: { from_view: FocusView | null };
  mobile_viewed: { from_view: FocusView | null };
  library_viewed: { from_view: FocusView | null };

  project_added: { type: 'local' | 'ssh'; strategy: 'open' | 'create' | 'clone'; success: boolean };
  project_deleted: EmptyProps;
  project_archived: EmptyProps;
  project_unarchived: EmptyProps;

  task_created: {
    strategy: 'blank' | 'branch' | 'issue' | 'pr';
    has_initial_prompt: boolean;
    has_issue: 'github' | 'linear' | 'jira' | 'gitlab' | 'plain' | 'forgejo' | 'none';
    provider: RuntimeId | null;
  };
  task_provisioned: EmptyProps;
  task_archived: EmptyProps;
  task_status_changed: { from_status: TaskLifecycleStatus; to_status: TaskLifecycleStatus };
  kanban_task_moved: {
    from_status: TaskLifecycleStatus;
    to_status: TaskLifecycleStatus;
    hook_count: number;
  };
  task_deleted: EmptyProps;
  task_moved_to_project: EmptyProps;

  conversation_created: { provider: RuntimeId; is_first_in_task: boolean };
  conversation_archived: EmptyProps;
  conversation_unarchived: EmptyProps;
  conversation_deleted: EmptyProps;
  agent_run_started: { provider: RuntimeId };
  agent_run_finished: { provider: RuntimeId; exit_code: number };

  terminal_created: { terminal_id: string };
  terminal_deleted: { terminal_id: string };

  pr_created: { is_draft: boolean };
  pr_creation_failed: { error_type: string };
  pr_merged: {
    strategy: 'merge' | 'squash' | 'rebase';
    success: boolean;
    error_type?: string;
  };
  /** Local quick-merge of a task branch back into its source branch. */
  task_branch_merged: {
    success: boolean;
    error_type?: string;
  };

  vcs_branch_published: { success: boolean; error_type?: string };
  vcs_fetch: { success: boolean; error_type?: string };
  vcs_push: { success: boolean; error_type?: string };
  vcs_pull: { success: boolean; strategy?: string; conflicts?: boolean; error_type?: string };
  vcs_files_staged: { count: number; scope: 'single' | 'multiple' | 'all' };
  vcs_files_unstaged: { count: number; scope: 'single' | 'multiple' | 'all' };
  vcs_files_discarded: { count: number; scope: 'single' | 'multiple' | 'all' };

  user_signed_in: EmptyProps;
  user_signed_out: EmptyProps;

  integration_connected: { provider: 'github' | 'linear' | 'jira' };
  integration_disconnected: { provider: 'github' | 'linear' | 'jira' };
  issue_linked_to_task: { provider: 'github' | 'linear' | 'jira' | 'gitlab' | 'plain' | 'forgejo' };

  open_in_external: { app: OpenInAppId | 'browser' };
  ssh_connection_attempted: { success: boolean };

  mcp_server_added: { source: 'catalog' | 'custom' };
  mcp_server_removed: EmptyProps;

  maas_platform_connected: { platform: MaasPlatformId };
  ai_lab_logo_generated: {
    engine: string;
    model: string;
    status: string;
    count: number;
    durationMs: number;
  };
  maas_platform_disconnected: { platform: MaasPlatformId };

  skill_installed: { source?: string };
  skill_uninstalled: EmptyProps;
  skill_disabled: EmptyProps;
  skill_enabled: EmptyProps;
  skill_created: EmptyProps;

  setting_changed: { setting: SettingName };
  sidebar_toggled: { side: 'left' | 'right'; state: 'open' | 'closed' };

  $exception: {
    $exception_message: string;
    $exception_type: string;
    $exception_stack_trace_raw: string;
    $exception_fingerprint?: string;
    severity?: 'low' | 'medium' | 'high' | 'critical';
    component?: string;
    action?: string;
    user_action?: string;
    operation?: string;
    endpoint?: string;
    session_errors?: number;
    error_timestamp?: string;
    error_type?: string;
  };
  error: { error_type: string; scope: string };
};

export type TelemetryEvent = keyof TelemetryEventProperties;
export type TelemetryProperties<E extends TelemetryEvent> = TelemetryEventProperties[E] &
  TelemetryEnvelope;
