import z from 'zod';
import { customThemeSelectionSchema, customThemesSettingsSchema } from '@shared/custom-theme';
import { KANBAN_STATUSES } from '@shared/kanban';
import { MAAS_PLATFORM_IDS } from '@shared/maas';
import { openInAppIdSchema } from '@shared/openInApps';
import { quickActionSchema } from '@shared/project-settings';
import { RUNTIME_MODEL_CANDIDATE_SOURCES } from '@shared/runtime-model-candidates';
import { AGENT_ACCOUNT_PROVIDER_IDS, RUNTIME_IDS, RUNTIMES } from '@shared/runtime-registry';
import {
  DEFAULT_SUMMARY_CONTEXT_GLOBAL,
  DEFAULT_SUMMARY_CONTEXT_RECENT,
  SUMMARY_CONTEXT_SOURCE_IDS,
} from '@shared/session-summary';
import {
  DEFAULT_TASK_NAMING_RECENT_TASK_LIMIT,
  DEFAULT_TASK_NAMING_TIMEOUT_MS,
  normalizeTaskNamingTimeoutMs,
  TASK_NAMING_CONTEXT_SOURCE_IDS,
} from '@shared/task-naming';
import {
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  MAX_TERMINAL_SCROLLBACK_LINES,
  MIN_TERMINAL_SCROLLBACK_LINES,
} from '@shared/terminal-settings';
import { DEFAULT_RUNTIME_ID } from './settings-registry';

export const projectSettingsSchema = z.object({
  pushOnCreate: z.boolean(),
  createBranchAndWorktree: z.boolean(),
  branchPrefix: z.string(),
  tmuxByDefault: z.boolean(),
});

export const localProjectSettingsSchema = z.object({
  defaultProjectsDirectory: z.string(),
  /** Where task worktrees live: inside each project (`<project>/.worktrees`)
   *  or in the central pool at `defaultWorktreeDirectory`. */
  worktreeLocationMode: z.enum(['project', 'central']).catch('central'),
  defaultWorktreeDirectory: z.string(),
  writeAgentConfigToGitIgnore: z.boolean(),
});

export const notificationSettingsSchema = z.object({
  enabled: z.boolean(),
  sound: z.boolean(),
  osNotifications: z.boolean(),
  soundFocusMode: z.enum(['always', 'unfocused']),
});

const summaryContextSchema = z.object(
  Object.fromEntries(SUMMARY_CONTEXT_SOURCE_IDS.map((id) => [id, z.boolean()])) as Record<
    (typeof SUMMARY_CONTEXT_SOURCE_IDS)[number],
    z.ZodBoolean
  >
);

export const taskSettingsSchema = z.object({
  autoGenerateName: z.boolean(),
  /** Initialize the task name from the initial session's auto-generated title. */
  initTaskNameFromSession: z.boolean().catch(true),
  /**
   * How auto-created branches are named: 'hash' = short time hash at creation
   * (stable, never renamed); 'ai' = semantic slug from the naming agent,
   * applied by a background branch rename once naming completes.
   */
  branchNaming: z.enum(['hash', 'ai']).catch('hash'),
  /** Agent that drives task naming. Empty = use the built-in naming Agent. */
  namingAgentId: z.string().catch(''),
  /** Agent that drives session-summary generation. Empty = built-in summary Agent. */
  summaryAgentId: z.string().catch(''),
  /** Output language for generated session summaries. */
  summaryLanguage: z.enum(['app', 'prompt', 'en', 'zh-CN']).catch('app'),
  /** Which transcript parts feed the `recent` summary (defaults to user-only for speed). */
  summaryContextRecent: summaryContextSchema.catch(DEFAULT_SUMMARY_CONTEXT_RECENT),
  /** Which transcript parts feed the `global` summary (defaults to everything). */
  summaryContextGlobal: summaryContextSchema.catch(DEFAULT_SUMMARY_CONTEXT_GLOBAL),
  namingModel: z.string(),
  namingLanguage: z.enum(['app', 'prompt', 'en', 'zh-CN']),
  namingContext: z.object(
    Object.fromEntries(TASK_NAMING_CONTEXT_SOURCE_IDS.map((id) => [id, z.boolean()])) as Record<
      (typeof TASK_NAMING_CONTEXT_SOURCE_IDS)[number],
      z.ZodBoolean
    >
  ),
  namingRecentTaskLimit: z
    .number()
    .int()
    .min(0)
    .max(20)
    .catch(DEFAULT_TASK_NAMING_RECENT_TASK_LIMIT),
  namingRequestTimeoutMs: z
    .number()
    .int()
    .catch(DEFAULT_TASK_NAMING_TIMEOUT_MS)
    .transform((value) => normalizeTaskNamingTimeoutMs(value)),
  autoTrustWorktrees: z.boolean(),
});

export const runtimeAutoApproveDefaultsSchema = z
  .partialRecord(z.enum(RUNTIME_IDS), z.boolean())
  .default({});

export const automationStatusSchema = z.enum(['active', 'paused']);

export const automationEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  workspaceName: z.string(),
  prompt: z.string(),
  runtime: z.enum(RUNTIME_IDS),
  scheduleLabel: z.string(),
  status: automationStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  lastRunAt: z.string().nullable(),
});

export const automationsSettingsSchema = z.object({
  items: z.array(
    z.preprocess(
      // provider→runtime terminology migration for persisted entries
      (value) =>
        value && typeof value === 'object' && 'provider' in value && !('runtime' in value)
          ? { ...value, runtime: (value as { provider?: unknown }).provider }
          : value,
      automationEntrySchema
    )
  ),
});

export const kanbanHookActionSchema = z.discriminatedUnion('type', [
  /** Inject a prompt into the task's live agent sessions. */
  z.object({ type: z.literal('prompt'), text: z.string() }),
  /** Run a shell command in the task's worktree (project root when none). */
  z.object({ type: z.literal('command'), command: z.string() }),
  /** Show an OS notification. */
  z.object({ type: z.literal('notify'), message: z.string() }),
]);

export const kanbanColumnHookSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  action: kanbanHookActionSchema,
});

export const kanbanSettingsSchema = z.object({
  /** Hooks executed in the main process when a card is dropped into a column. */
  hooksByStatus: z.partialRecord(z.enum(KANBAN_STATUSES), z.array(kanbanColumnHookSchema)),
});

export const maasPlatformIdSchema = z.enum(MAAS_PLATFORM_IDS);

export const maasConnectionSchema = z.object({
  platformId: maasPlatformIdSchema,
  displayName: z.string(),
  endpoint: z.string(),
  keyFingerprint: z.string().nullable(),
  connectedAt: z.string().nullable(),
  lastCheckedAt: z.string().nullable(),
});

export const maasSettingsSchema = z.object({
  selectedPlatformId: maasPlatformIdSchema,
  connections: z.array(maasConnectionSchema),
});

export const runtimeModelCandidateCacheEntrySchema = z.object({
  source: z.enum(RUNTIME_MODEL_CANDIDATE_SOURCES),
  models: z.array(z.string()),
  fetchedAt: z.string(),
  expiresAt: z.string(),
  error: z.string().optional(),
});

export const runtimeModelCandidateSettingsSchema = z.preprocess(
  (value) => (Array.isArray(value) ? { sources: value, hiddenModels: [] } : value),
  z.object({
    sources: z.array(runtimeModelCandidateCacheEntrySchema).default([]),
    hiddenModels: z.array(z.string()).default([]),
  })
);

export const runtimeModelCandidatesSettingsSchema = z.preprocess(
  // providers→runtimes terminology migration for the persisted record
  (value) =>
    value && typeof value === 'object' && 'providers' in value && !('runtimes' in value)
      ? { runtimes: (value as { providers?: unknown }).providers }
      : value,
  z.object({
    runtimes: z.partialRecord(z.enum(RUNTIME_IDS), runtimeModelCandidateSettingsSchema).default({}),
  })
);

export const terminalSettingsSchema = z.object({
  fontFamily: z.string().optional(),
  autoCopyOnSelection: z.boolean(),
  scrollbackLines: z
    .number()
    .int()
    .min(MIN_TERMINAL_SCROLLBACK_LINES)
    .max(MAX_TERMINAL_SCROLLBACK_LINES)
    .catch(DEFAULT_TERMINAL_SCROLLBACK_LINES),
});

const legacyThemeSchema = z
  .enum(['ylight', 'ydark', 'ywarm', 'ygreen', 'ylight2', 'ymatrix', 'emlight', 'emdark'])
  .transform((value) => {
    if (value === 'emlight') return 'ylight' as const;
    if (value === 'emdark') return 'ydark' as const;
    // 'ymatrix' graduated into the ydark base palette.
    if (value === 'ymatrix') return 'ydark' as const;
    return value;
  });

const themeSelectionSchema = z.union([legacyThemeSchema, customThemeSelectionSchema]);

// Default for fresh installs is Yoda Green (the brand theme). `null` remains
// the explicit "follow system" choice.
export const themeSchema = themeSelectionSchema.nullable().catch('ygreen').default('ygreen');

/** Which theme each system appearance maps to when "follow system" is active. */
export const systemThemesSchema = z
  .object({
    light: themeSelectionSchema.catch('ylight'),
    dark: themeSelectionSchema.catch('ydark'),
  })
  .catch({ light: 'ylight', dark: 'ydark' })
  .default({ light: 'ylight', dark: 'ydark' });

export const defaultRuntimeSchema = z.optional(z.enum(RUNTIME_IDS)).default(DEFAULT_RUNTIME_ID);

export const keyboardSettingsSchema = z
  .optional(
    z.object({
      commandPalette: z.string().nullable().optional(),
      commandPaletteTasks: z.string().nullable().optional(),
      settings: z.string().nullable().optional(),
      toggleLeftSidebar: z.string().nullable().optional(),
      toggleRightSidebar: z.string().nullable().optional(),
      toggleTheme: z.string().nullable().optional(),
      closeModal: z.string().nullable().optional(),
      newTask: z.string().nullable().optional(),
      newProject: z.string().nullable().optional(),
      openInEditor: z.string().nullable().optional(),
      sidebarChanges: z.string().nullable().optional(),
      sidebarConversations: z.string().nullable().optional(),
      sidebarFiles: z.string().nullable().optional(),
      sidebarTask: z.string().nullable().optional(),
      tabNext: z.string().nullable().optional(),
      tabPrev: z.string().nullable().optional(),
      tabClose: z.string().nullable().optional(),
      tab1: z.string().nullable().optional(),
      tab2: z.string().nullable().optional(),
      tab3: z.string().nullable().optional(),
      tab4: z.string().nullable().optional(),
      tab5: z.string().nullable().optional(),
      tab6: z.string().nullable().optional(),
      tab7: z.string().nullable().optional(),
      tab8: z.string().nullable().optional(),
      tab9: z.string().nullable().optional(),
      newConversation: z.string().nullable().optional(),
      newTerminal: z.string().nullable().optional(),
      confirm: z.string().nullable().optional(),
      toggleTerminalDrawer: z.string().nullable().optional(),
      navigateBack: z.string().nullable().optional(),
      navigateForward: z.string().nullable().optional(),
    })
  )
  .default({});

export const runtimeCustomConfigEntrySchema = z.object({
  authProvider: z.enum(AGENT_ACCOUNT_PROVIDER_IDS).optional(),
  cli: z.string().optional(),
  resumeFlag: z.string().optional(),
  resumeSessionIdArg: z.boolean().optional(),
  defaultArgs: z.array(z.string()).optional(),
  autoApproveFlag: z.string().optional(),
  initialPromptFlag: z.string().optional(),
  sessionIdFlag: z.string().optional(),
  sessionIdOnResumeOnly: z.boolean().optional(),
  extraArgs: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  namingModel: z.string().optional(),
  namingCommand: z.string().optional(),
});

export const runtimeConfigDefaults = Object.fromEntries(
  RUNTIMES.filter(
    (p) =>
      p.cli ||
      p.resumeFlag ||
      p.autoApproveFlag ||
      p.initialPromptFlag ||
      p.defaultArgs ||
      p.namingCommand
  ).map((p) => [
    p.id,
    {
      ...(p.cli ? { cli: p.cli } : {}),
      ...(p.resumeFlag ? { resumeFlag: p.resumeFlag } : {}),
      ...(p.resumeSessionIdArg ? { resumeSessionIdArg: p.resumeSessionIdArg } : {}),
      ...(p.autoApproveFlag ? { autoApproveFlag: p.autoApproveFlag } : {}),
      ...(p.initialPromptFlag !== undefined ? { initialPromptFlag: p.initialPromptFlag } : {}),
      ...(p.defaultArgs ? { defaultArgs: p.defaultArgs } : {}),
      ...(p.sessionIdFlag ? { sessionIdFlag: p.sessionIdFlag } : {}),
      ...(p.sessionIdOnResumeOnly ? { sessionIdOnResumeOnly: p.sessionIdOnResumeOnly } : {}),
      ...(p.namingCommand ? { namingCommand: p.namingCommand } : {}),
    },
  ])
);

export const interfaceSettingsSchema = z.object({
  taskHoverAction: z.enum(['delete', 'archive']),
  autoRightSidebarBehavior: z.boolean(),
  /** Dock the active session's prompt history at the bottom of the conversation pane. */
  dockSessionHistory: z.boolean(),
  /** Visible row count for the docked prompt history before it scrolls. */
  dockSessionHistoryRows: z.number().int().min(1).max(20),
});

export const browserPreviewSettingsSchema = z.object({ enabled: z.boolean() });

const homeRunModeSchema = z.enum(['normal', 'brainstorm', 'compare', 'review', 'team']);
const teamRuntimeSelectionSchema = z.object({
  ceo: z.enum(RUNTIME_IDS),
  product: z.enum(RUNTIME_IDS),
  engineering: z.enum(RUNTIME_IDS),
  uiux: z.enum(RUNTIME_IDS),
  operations: z.enum(RUNTIME_IDS),
});

/** provider→runtime terminology migration for persisted home drafts. */
const HOME_DRAFT_LEGACY_FIELDS: Record<string, string> = {
  providerOverride: 'runtimeOverride',
  compareProviders: 'compareRuntimes',
  reviewReviewerProvider: 'reviewReviewerRuntime',
  teamProviders: 'teamRuntimes',
};

export const homeDraftSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    let migrated: Record<string, unknown> | null = null;
    for (const [oldKey, newKey] of Object.entries(HOME_DRAFT_LEGACY_FIELDS)) {
      if (oldKey in record && !(newKey in record)) {
        migrated ??= { ...record };
        migrated[newKey] = record[oldKey];
        delete migrated[oldKey];
      }
    }
    return migrated ?? value;
  },
  z.object({
    prompt: z.string(),
    selectedProjectId: z.string().nullable(),
    strategyKind: z.enum(['new-branch', 'no-worktree']),
    reviewStrategyKind: z.enum(['new-branch', 'no-worktree']),
    /** User-picked base branch for forked tasks. null = project default branch.
     *  Cleared whenever the composer switches projects. */
    baseBranch: z
      .object({
        type: z.enum(['local', 'remote']),
        branch: z.string(),
        remoteName: z.string().optional(),
      })
      .nullable(),
    runtimeOverride: z.enum(RUNTIME_IDS).nullable(),
    runMode: homeRunModeSchema,
    compareRuntimes: z.array(z.enum(RUNTIME_IDS)),
    reviewReviewerRuntime: z.enum(RUNTIME_IDS),
    teamRuntimes: teamRuntimeSelectionSchema,
    /** Selected Agent Team template id for the `team` paradigm (built-in or user). */
    selectedTeamId: z.string().default('builtin:startup'),
    agentSystemPrompts: z.record(z.string(), z.string().nullable()),
    /** Selected user-defined Agent ids per run mode. Keyed by HomeRunMode; the
     *  value is an array (single-element for solo modes, multiple for team). An
     *  empty/absent entry means "use the raw runtime", preserving native behavior. */
    selectedAgentIds: z.record(z.string(), z.array(z.string())),
    /** When true, the sidebar "+" button creates a task immediately using the
     *  last home-draft agent runtime config instead of opening the home view. */
    expressMode: z.boolean(),
    /** When true, image attachments are sent as @path mentions instead of
     *  being pasted natively (clipboard + Ctrl+V) into the agent TUI. */
    attachImagesAsPaths: z.boolean(),
    /** Attachment-token registry backing the inline sentinels in `prompt` —
     *  label → absolute path. Persisted with the draft so tokens survive the
     *  composer remounting on navigation. */
    promptTokens: z.array(
      z.object({
        kind: z.enum(['image', 'file']),
        label: z.string(),
        path: z.string(),
      })
    ),
    /** When non-empty, archiving a task or session first sends this skill or
     *  command to the target conversation and waits for the agent to finish
     *  before performing the actual archive. Bare skill/command names are
     *  prefixed for the target agent, e.g. "lovstudio-git-commit-with-context"
     *  becomes "$lovstudio-git-commit-with-context" for Codex or
     *  "/lovstudio-git-commit-with-context" for Claude. */
    preArchiveCommand: z.string(),
    /** Global default quick-action commands shown on each project's overview.
     *  Projects can override via ShareableProjectSettings.quickActions. */
    defaultQuickActions: z.array(quickActionSchema),
  })
);

export const openInSettingsSchema = z.object({
  default: openInAppIdSchema,
  hidden: z.array(openInAppIdSchema),
});

/** A candidate statusline command the user can switch to from the session panel. */
export const statuslineTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Shell command; receives the runtime's session JSON payload on stdin. */
  command: z.string(),
});

export const statuslineSettingsSchema = z.object({
  templates: z.array(statuslineTemplateSchema),
});

/** An atomic, user-defined operating principle for agent runtimes. */
export const promptPrincipleSchema = z.object({
  id: z.string(),
  name: z.string(),
  text: z.string(),
  /** Enabled principles are appended after the runtime's system prompt at spawn. */
  enabled: z.boolean(),
});

export const promptPrinciplesSettingsSchema = z.object({
  items: z.array(promptPrincipleSchema),
});

export const APP_SETTINGS_SCHEMA_MAP = {
  localProject: localProjectSettingsSchema,
  project: projectSettingsSchema,
  tasks: taskSettingsSchema,
  runtimeAutoApproveDefaults: runtimeAutoApproveDefaultsSchema,
  automations: automationsSettingsSchema,
  kanban: kanbanSettingsSchema,
  maas: maasSettingsSchema,
  runtimeModelCandidates: runtimeModelCandidatesSettingsSchema,
  defaultRuntime: defaultRuntimeSchema,
  keyboard: keyboardSettingsSchema,
  notifications: notificationSettingsSchema,
  theme: themeSchema,
  systemThemes: systemThemesSchema,
  openIn: openInSettingsSchema,
  interface: interfaceSettingsSchema,
  terminal: terminalSettingsSchema,
  customThemes: customThemesSettingsSchema,
  browserPreview: browserPreviewSettingsSchema,
  homeDraft: homeDraftSchema,
  statusline: statuslineSettingsSchema,
  promptPrinciples: promptPrinciplesSettingsSchema,
} as const;

export const appSettingsSchema = z.object({
  localProject: localProjectSettingsSchema,
  project: projectSettingsSchema,
  tasks: taskSettingsSchema,
  runtimeAutoApproveDefaults: runtimeAutoApproveDefaultsSchema,
  automations: automationsSettingsSchema,
  kanban: kanbanSettingsSchema,
  maas: maasSettingsSchema,
  runtimeModelCandidates: runtimeModelCandidatesSettingsSchema,
  defaultRuntime: defaultRuntimeSchema,
  keyboard: keyboardSettingsSchema,
  notifications: notificationSettingsSchema,
  theme: themeSchema,
  systemThemes: systemThemesSchema,
  openIn: openInSettingsSchema,
  interface: interfaceSettingsSchema,
  terminal: terminalSettingsSchema,
  customThemes: customThemesSettingsSchema,
  browserPreview: browserPreviewSettingsSchema,
  homeDraft: homeDraftSchema,
  statusline: statuslineSettingsSchema,
  promptPrinciples: promptPrinciplesSettingsSchema,
});
