import z from 'zod';
import { AGENT_REPLY_DISPLAY_LEVELS } from '@shared/agent-reply-display';
import { customThemeSelectionSchema, customThemesSettingsSchema } from '@shared/custom-theme';
import {
  DEFAULT_LLM_PROFILE_ACCESS_METHOD,
  DEFAULT_LLM_PROFILE_ID,
  DEFAULT_LLM_PROFILE_MAAS_PLATFORM_ID,
  DEFAULT_LLM_PROFILE_NAME,
  DEFAULT_LLM_PROFILE_RUNTIME_ID,
  LLM_REASONING_EFFORT_IDS,
  normalizeLlmSettings,
} from '@shared/global-llm';
import {
  MAX_ISSUE_WORKER_CONCURRENCY,
  MAX_ISSUE_WORKER_POLL_INTERVAL_SECONDS,
  MIN_ISSUE_WORKER_POLL_INTERVAL_SECONDS,
} from '@shared/issue-worker';
import { KANBAN_STATUSES } from '@shared/kanban';
import { isMaasPlatformId, migrateLegacyMaasPlatformId, type MaasPlatformId } from '@shared/maas';
import { DEFAULT_MOBILE_SYNC_MODE, MOBILE_SYNC_MODES } from '@shared/mobile-sync';
import {
  MAX_CUSTOM_MODEL_PROVIDERS,
  MAX_CUSTOM_MODELS_PER_PROVIDER,
} from '@shared/model-provider-catalog';
import {
  DEFAULT_NOTIFICATION_CENTER_SOURCES,
  NOTIFICATION_SOURCES,
  type NotificationSource,
} from '@shared/notifications';
import { openInAppIdSchema } from '@shared/openInApps';
import { LEGACY_RUN_MODES, normalizeLegacyRunMode } from '@shared/paradigms/kinds';
import { promptPrincipleSchema, taskOutputLanguageValues } from '@shared/project-settings';
import { runtimeIdSchema } from '@shared/runtime-id-schema';
import { RUNTIME_MODEL_CANDIDATE_CACHE_SOURCES } from '@shared/runtime-model-candidates';
import { AGENT_ACCOUNT_PROVIDER_IDS, RUNTIMES } from '@shared/runtime-registry';
import {
  getDefaultRuntimeStatusMonitor,
  RUNTIME_STATUS_MONITOR_IDS,
} from '@shared/runtime-status-monitor';
import {
  DEFAULT_SUMMARY_CONTEXT_GLOBAL,
  DEFAULT_SUMMARY_CONTEXT_RECENT,
  SUMMARY_CONTEXT_SOURCE_IDS,
} from '@shared/session-summary';
import {
  DEFAULT_TASK_APPEARANCE_SETTINGS,
  MULTI_AGENT_TASK_MARKERS,
  TASK_MARKERS,
  TASK_TITLE_STYLES,
} from '@shared/task-appearance';
import {
  DEFAULT_TASK_NAMING_RECENT_TASK_LIMIT,
  DEFAULT_TASK_NAMING_TIMEOUT_MS,
  normalizeTaskNamingTimeoutMs,
  TASK_NAMING_CONTEXT_SOURCE_IDS,
} from '@shared/task-naming';
import {
  DEFAULT_HOT_TERMINAL_LIMIT,
  DEFAULT_IDLE_SESSION_TIMEOUT_MINUTES,
  DEFAULT_TERMINAL_CACHE_MODE,
  DEFAULT_TERMINAL_LINK_OPEN,
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  MAX_HOT_TERMINAL_LIMIT,
  MAX_IDLE_SESSION_TIMEOUT_MINUTES,
  MAX_TERMINAL_SCROLLBACK_LINES,
  MIN_HOT_TERMINAL_LIMIT,
  MIN_TERMINAL_SCROLLBACK_LINES,
  TERMINAL_CACHE_MODES,
  TERMINAL_LINK_URL_HANDLERS,
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

const notificationCenterSourcesSchema = z.object(
  Object.fromEntries(NOTIFICATION_SOURCES.map((source) => [source, z.boolean()])) as Record<
    NotificationSource,
    z.ZodBoolean
  >
);

export const notificationSettingsSchema = z.object({
  enabled: z.boolean(),
  sound: z.boolean(),
  osNotifications: z.boolean(),
  soundFocusMode: z.enum(['always', 'unfocused']),
  /** Optional per-event controls. Missing values fall back to legacy notification fields. */
  permissionNotifications: z.boolean().optional(),
  questionNotifications: z.boolean().optional(),
  /** Show an in-app action when a Codex account quota reaches the configured threshold. */
  accountUsageWarningEnabled: z.boolean().catch(true),
  accountUsageWarningThreshold: z.number().int().min(1).max(100).catch(95),
  /** Which producers may enter the in-app notification center. */
  notificationCenterSources: notificationCenterSourcesSchema.catch(
    DEFAULT_NOTIFICATION_CENTER_SOURCES
  ),
});

const summaryContextSchema = z.object(
  Object.fromEntries(SUMMARY_CONTEXT_SOURCE_IDS.map((id) => [id, z.boolean()])) as Record<
    (typeof SUMMARY_CONTEXT_SOURCE_IDS)[number],
    z.ZodBoolean
  >
);

export const taskSettingsSchema = z.object({
  /** Whether workspace organization and filtering are exposed in the task UI. */
  workspacesEnabled: z.boolean().catch(false),
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
  /**
   * Whether summaries may be generated without an explicit user request — the
   * post-turn refresh and the panel's own `recent` note. An explicit
   * regenerate always runs, so turning this off never makes summaries
   * unreachable, only unprompted.
   */
  autoGenerateSummary: z.boolean().catch(true),
  /** Agent that drives session-summary generation. Empty = built-in summary Agent. */
  summaryAgentId: z.string().catch(''),
  /** Target language for rewriting the user's input prompt before sending. */
  inputPromptLanguage: z.enum(taskOutputLanguageValues).catch('skip'),
  /** Output language for generated session summaries. */
  summaryLanguage: z.enum(taskOutputLanguageValues).catch('app'),
  /** Which transcript parts feed the `recent` summary (defaults to user-only for speed). */
  summaryContextRecent: summaryContextSchema.catch(DEFAULT_SUMMARY_CONTEXT_RECENT),
  /** Which transcript parts feed the `global` summary (defaults to everything). */
  summaryContextGlobal: summaryContextSchema.catch(DEFAULT_SUMMARY_CONTEXT_GLOBAL),
  namingModel: z.string(),
  namingLanguage: z.enum(taskOutputLanguageValues).catch('skip'),
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
  .partialRecord(runtimeIdSchema, z.boolean())
  .default({});

/** Per-runtime selected permission-mode id (see runtime-registry permissionModes). */
export const runtimePermissionModesSchema = z
  .partialRecord(runtimeIdSchema, z.string())
  .default({});

export const automationStatusSchema = z.enum(['active', 'paused']);

export const automationEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  workspaceName: z.string(),
  prompt: z.string(),
  runtime: runtimeIdSchema,
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

export const issueWorkerProjectConfigSchema = z.object({
  enabled: z.boolean(),
  runtime: runtimeIdSchema,
  concurrency: z.number().int().min(1).max(MAX_ISSUE_WORKER_CONCURRENCY),
  pollIntervalSeconds: z
    .number()
    .int()
    .min(MIN_ISSUE_WORKER_POLL_INTERVAL_SECONDS)
    .max(MAX_ISSUE_WORKER_POLL_INTERVAL_SECONDS),
  managedTaskIds: z.array(z.string()).max(1_000).catch([]),
});

export const issueWorkerSettingsSchema = z.object({
  projects: z.record(z.string(), issueWorkerProjectConfigSchema),
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

export const maasPlatformIdSchema = z.preprocess(
  migrateLegacyMaasPlatformId,
  z.custom<MaasPlatformId>(isMaasPlatformId, {
    message: 'Invalid MaaS platform ID',
  })
);

export const runtimeCustomConfigEntrySchema = z.object({
  /** Disabled runtimes stay installed but cannot start new Yoda sessions. */
  disabled: z.boolean().optional(),
  authProvider: z.enum(AGENT_ACCOUNT_PROVIDER_IDS).optional(),
  maasPlatformId: maasPlatformIdSchema.optional(),
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
  /** Default model for new sessions when an Agent/slot does not override it. */
  defaultModel: z.string().optional(),
  /** Default Codex reasoning effort for new sessions. */
  defaultReasoningEffort: z.string().optional(),
  /** Default Codex Fast mode for new sessions. */
  defaultFastMode: z.boolean().optional(),
  /** Client-specific source used to observe live session state. */
  statusMonitor: z.enum(RUNTIME_STATUS_MONITOR_IDS).optional(),
  namingModel: z.string().optional(),
  namingCommand: z.string().optional(),
});

export const maasConnectionSchema = z.object({
  platformId: maasPlatformIdSchema,
  displayName: z.string(),
  endpoint: z.string(),
  websiteUrl: z.string().optional(),
  description: z.string().optional(),
  logoUrl: z.string().optional(),
  envKey: z.string().optional(),
  syncToAgentClient: z.boolean().optional(),
  syncToAgentClientVersion: z.literal(1).optional(),
  keyFingerprint: z.string().nullable(),
  inferenceKeyFingerprint: z.string().nullable().default(null),
  accountKeyFingerprint: z.string().nullable().default(null),
  connectedAt: z.string().nullable(),
  lastCheckedAt: z.string().nullable(),
  lastTest: z
    .object({
      ok: z.boolean(),
      error: z.string().nullable(),
      checkedAt: z.string(),
      samples: z.array(
        z.object({
          durationMs: z.number().nonnegative(),
          ok: z.boolean(),
          error: z.string().nullable(),
        })
      ),
      averageLatencyMs: z.number().nonnegative().nullable(),
    })
    .nullable()
    .default(null),
});

export const maasRuntimeBindingSchema = z.object({
  runtimeId: runtimeIdSchema,
  platformId: maasPlatformIdSchema,
  previousAuthProvider: z.enum(AGENT_ACCOUNT_PROVIDER_IDS).nullable(),
  previousMaasPlatformId: maasPlatformIdSchema.nullable(),
  previousConfig: runtimeCustomConfigEntrySchema.optional(),
  enabledAt: z.string(),
});

export const maasSettingsSchema = z.object({
  selectedPlatformId: maasPlatformIdSchema,
  connections: z.array(maasConnectionSchema),
  runtimeBindings: z.array(maasRuntimeBindingSchema).default([]),
  /** Explicit consent to publish the active MaaS route outside Yoda. */
  externalAgentSyncEnabled: z.boolean().optional(),
  externalAgentSyncVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  externalAgentSyncLoginItemEnabled: z.boolean().optional(),
});

export const llmProfileSchema = z.object({
  id: z.string().min(1).catch(DEFAULT_LLM_PROFILE_ID),
  name: z.string().min(1).catch(DEFAULT_LLM_PROFILE_NAME),
  runtimeId: runtimeIdSchema.catch(DEFAULT_LLM_PROFILE_RUNTIME_ID),
  authProvider: z.enum(AGENT_ACCOUNT_PROVIDER_IDS).catch(DEFAULT_LLM_PROFILE_ACCESS_METHOD),
  maasPlatformId: maasPlatformIdSchema.catch(DEFAULT_LLM_PROFILE_MAAS_PLATFORM_ID),
  model: z.string().catch(''),
  imageModel: z.string().catch(''),
  reasoningEffort: z.enum(LLM_REASONING_EFFORT_IDS).catch('default'),
  permissionMode: z.string().catch('default'),
});

export const globalLlmSettingsSchema = z
  .preprocess(
    (value) => normalizeLlmSettings(value as never),
    z.object({
      profiles: z.array(llmProfileSchema).min(1),
      defaultProfileId: z.string(),
      namingProfileId: z.string(),
      imageGenerationProfileId: z.string(),
      promptTranslationEnabled: z.boolean().catch(false),
      promptTranslationProfileId: z.string(),
      promptTranslationShowOriginal: z.boolean().catch(true),
    })
  )
  .transform((value) => normalizeLlmSettings(value));

export const modelProviderSettingsSchema = z.object({
  automaticUpdatesEnabled: z.boolean().default(true),
  lastAutomaticRefreshAt: z.string().nullable().default(null),
  providers: z
    .record(
      z.string().trim().min(1).max(60),
      z.object({
        name: z.string().trim().min(1).max(60).optional(),
        customModels: z
          .array(z.string().trim().min(2).max(100))
          .max(MAX_CUSTOM_MODELS_PER_PROVIDER)
          .default([]),
      })
    )
    .refine(
      (providers) =>
        Object.values(providers).filter((provider) => provider.name !== undefined).length <=
        MAX_CUSTOM_MODEL_PROVIDERS,
      `A maximum of ${MAX_CUSTOM_MODEL_PROVIDERS} custom model providers is allowed.`
    )
    .default({}),
  catalogCache: z
    .object({
      official: z
        .record(
          z.string().trim().min(1).max(60),
          z.object({
            models: z.array(z.string().trim().min(2).max(100)).max(1_000).default([]),
            fetchedAt: z.string().nullable().default(null),
            lastAttemptAt: z.string().nullable().default(null),
            error: z.string().optional(),
          })
        )
        .default({}),
      aggregate: z
        .object({
          models: z.array(z.string().trim().min(2).max(100)).max(5_000).default([]),
          fetchedAt: z.string().nullable().default(null),
          lastAttemptAt: z.string().nullable().default(null),
          error: z.string().optional(),
        })
        .default({
          models: [],
          fetchedAt: null,
          lastAttemptAt: null,
        }),
    })
    .default({
      official: {},
      aggregate: {
        models: [],
        fetchedAt: null,
        lastAttemptAt: null,
      },
    }),
});

export const runtimeModelCandidateCacheEntrySchema = z.object({
  source: z.enum(RUNTIME_MODEL_CANDIDATE_CACHE_SOURCES),
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
    runtimes: z.partialRecord(runtimeIdSchema, runtimeModelCandidateSettingsSchema).default({}),
  })
);

const terminalLinkFileHandlerSchema = z.union([
  z.literal('yoda'),
  z.literal('system'),
  openInAppIdSchema,
]);

export const terminalLinkOpenSettingsSchema = z.object({
  file: terminalLinkFileHandlerSchema.catch('yoda').default('yoda'),
  url: z.enum(TERMINAL_LINK_URL_HANDLERS).catch('yoda').default('yoda'),
  fileRules: z
    .array(
      z.object({
        extensions: z.array(z.string()).catch([]).default([]),
        handler: terminalLinkFileHandlerSchema.catch('yoda'),
      })
    )
    .catch([])
    .default([]),
});

export const terminalSettingsSchema = z.preprocess(
  // Migrate the single internal/external switch this replaced: it decided files
  // and URLs together, so "external" seeds both new handlers. Only a row written
  // by the old version still carries the key — `z.object` strips it on the next
  // write — so its presence is the migration signal. The reader merges defaults
  // in before parsing, which means `linkOpen` is always present here and cannot
  // be used to detect an already-migrated row.
  (value) => {
    if (!value || typeof value !== 'object') return value;
    if ((value as { smartPathOpenMode?: unknown }).smartPathOpenMode !== 'external') return value;
    return { ...value, linkOpen: { file: 'system', url: 'system', fileRules: [] } };
  },
  z.object({
    fontFamily: z.string().optional(),
    autoCopyOnSelection: z.boolean(),
    linkOpen: terminalLinkOpenSettingsSchema.catch(DEFAULT_TERMINAL_LINK_OPEN).default(
      // Cloned so a mutation through the settings object cannot reach the shared default.
      () => ({ ...DEFAULT_TERMINAL_LINK_OPEN, fileRules: [] })
    ),
    scrollbackLines: z
      .number()
      .int()
      .min(MIN_TERMINAL_SCROLLBACK_LINES)
      .max(MAX_TERMINAL_SCROLLBACK_LINES)
      .catch(DEFAULT_TERMINAL_SCROLLBACK_LINES),
    hotTerminalMode: z.enum(TERMINAL_CACHE_MODES).catch(DEFAULT_TERMINAL_CACHE_MODE),
    hotTerminalLimit: z
      .number()
      .int()
      .min(MIN_HOT_TERMINAL_LIMIT)
      .max(MAX_HOT_TERMINAL_LIMIT)
      .catch(DEFAULT_HOT_TERMINAL_LIMIT),
    idleSessionTimeoutMinutes: z
      .number()
      .int()
      .min(0)
      .max(MAX_IDLE_SESSION_TIMEOUT_MINUTES)
      .catch(DEFAULT_IDLE_SESSION_TIMEOUT_MINUTES),
  })
);

const legacyThemeSchema = z
  .enum([
    'ylight',
    'ydark',
    'ywarm',
    'ygreen',
    'ylight2',
    'ydream',
    'ydream-arina',
    'ydream-night',
    'ydream-fortune',
    'ydream-scifi',
    'ydream-clear',
    'ydream-cosmos',
    'ydream-purple',
    'ydream-virtual',
    'ydream-gold',
    'ymatrix',
    'emlight',
    'emdark',
  ])
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

export const defaultRuntimeSchema = runtimeIdSchema.optional().default(DEFAULT_RUNTIME_ID);

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
      disabled: false,
      ...(p.cli ? { cli: p.cli } : {}),
      ...(p.resumeFlag ? { resumeFlag: p.resumeFlag } : {}),
      ...(p.resumeSessionIdArg ? { resumeSessionIdArg: p.resumeSessionIdArg } : {}),
      ...(p.autoApproveFlag ? { autoApproveFlag: p.autoApproveFlag } : {}),
      ...(p.initialPromptFlag !== undefined ? { initialPromptFlag: p.initialPromptFlag } : {}),
      ...(p.defaultArgs ? { defaultArgs: p.defaultArgs } : {}),
      ...(p.sessionIdFlag ? { sessionIdFlag: p.sessionIdFlag } : {}),
      ...(p.sessionIdOnResumeOnly ? { sessionIdOnResumeOnly: p.sessionIdOnResumeOnly } : {}),
      ...(p.namingCommand ? { namingCommand: p.namingCommand } : {}),
      statusMonitor: getDefaultRuntimeStatusMonitor(p.id),
    },
  ])
);

const taskIdleOpacitySchema = z.union([
  z.literal(100),
  z.literal(85),
  z.literal(70),
  z.literal(55),
]);

const taskAppearancePresetSchema = z.object({
  titleStyle: z.enum(TASK_TITLE_STYLES),
  idleOpacity: taskIdleOpacitySchema,
  marker: z.enum(TASK_MARKERS),
});

export const taskAppearanceSettingsSchema = z.object({
  standard: taskAppearancePresetSchema,
  longTerm: taskAppearancePresetSchema,
  multiAgent: z.object({
    marker: z.enum(MULTI_AGENT_TASK_MARKERS),
  }),
});

export const interfaceSettingsSchema = z.object({
  taskHoverAction: z.enum(['delete', 'archive']),
  autoRightSidebarBehavior: z.boolean(),
  /** Which identity gets the primary text treatment in the sidebar footer. */
  sidebarStatusBarPrimary: z.enum(['product', 'account']).catch('product'),
  /** Where the global new-task action opens its composer. */
  newTaskOpenMode: z.enum(['home', 'modal']).catch('home'),
  /** How much of the agent's transcript appears in the Session → Conversation surface. */
  agentReplyDisplayLevel: z.enum(AGENT_REPLY_DISPLAY_LEVELS).catch('concise'),
  /** Dock the active session's prompt history at the bottom of the conversation pane. */
  dockSessionHistory: z.boolean(),
  /** Number of latest prompts shown after the first prompt in the docked history preview. */
  dockSessionHistoryRows: z.number().int().min(1).max(20),
  /** Composable visual rules for task rows across the sidebar's task-list variants. */
  taskAppearance: taskAppearanceSettingsSchema.default(DEFAULT_TASK_APPEARANCE_SETTINGS),
});

export const browserPreviewSettingsSchema = z.object({ enabled: z.boolean() });

const homeRunModeSchema = z.enum(LEGACY_RUN_MODES);

/** provider→runtime terminology migration for persisted home drafts. */
const HOME_DRAFT_LEGACY_FIELDS: Record<string, string> = {
  providerOverride: 'runtimeOverride',
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
    // A retired run mode coerces to vibe coding so an old draft still
    // satisfies the schema instead of failing the whole settings object.
    const normalizedRunMode = normalizeLegacyRunMode(record.runMode);
    if (normalizedRunMode !== record.runMode) {
      migrated ??= { ...record };
      migrated.runMode = normalizedRunMode;
    }
    // `selectedTeamId` was "which Agent Team", back when teams were the only
    // paradigm with more than one instance. Teams are now `team`-kind paradigm
    // instances keyed by the same id, so the remembered team carries over as the
    // remembered instance — but only for a draft that was actually on that
    // paradigm, or every draft would come back claiming to be a team.
    if (!('selectedParadigmId' in record)) {
      migrated ??= { ...record };
      if (record.runMode === 'team' && typeof record.selectedTeamId === 'string')
        migrated.selectedParadigmId = record.selectedTeamId;
      delete migrated.selectedTeamId;
    }
    return migrated ?? value;
  },
  z.object({
    prompt: z.string(),
    selectedProjectId: z.string().nullable(),
    strategyKind: z.enum(['new-branch', 'no-worktree']),
    /** User-picked base branch for forked tasks. null = project default branch.
     *  Cleared whenever the composer switches projects. */
    baseBranch: z
      .object({
        type: z.enum(['local', 'remote']),
        branch: z.string(),
        remoteName: z.string().optional(),
      })
      .nullable(),
    runtimeOverride: runtimeIdSchema.nullable(),
    runMode: homeRunModeSchema,
    /** Remembered paradigm instance id. Empty means "the kind's own built-in
     *  instance", which is what a draft that never picked one wants. */
    selectedParadigmId: z.string().default(''),
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

export const promptPrinciplesSettingsSchema = z.object({
  items: z.array(promptPrincipleSchema),
});

/** Network/proxy behavior for the auto-updater. `auto` follows the OS proxy;
 *  `custom` routes updater traffic through `proxyUrl` (e.g. http://127.0.0.1:7890).
 *  The updater runs in its own Electron session and does not pick up a CLI/shell
 *  proxy, so users behind ClashX-style proxies need this to reach GitHub. */
export const updatesSettingsSchema = z.object({
  source: z.enum(['official', 'china']).default('official'),
  proxyMode: z.enum(['auto', 'custom']).default('auto'),
  proxyUrl: z.string().default(''),
});

/** Which transports paired phones may use to reach this desktop. */
export const mobileSyncSettingsSchema = z.object({
  mode: z.enum(MOBILE_SYNC_MODES).default(DEFAULT_MOBILE_SYNC_MODE),
});

export const APP_SETTINGS_SCHEMA_MAP = {
  localProject: localProjectSettingsSchema,
  project: projectSettingsSchema,
  tasks: taskSettingsSchema,
  runtimeAutoApproveDefaults: runtimeAutoApproveDefaultsSchema,
  runtimePermissionModes: runtimePermissionModesSchema,
  automations: automationsSettingsSchema,
  issueWorker: issueWorkerSettingsSchema,
  kanban: kanbanSettingsSchema,
  maas: maasSettingsSchema,
  llm: globalLlmSettingsSchema,
  modelProviders: modelProviderSettingsSchema,
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
  updates: updatesSettingsSchema,
  mobileSync: mobileSyncSettingsSchema,
} as const;

export const appSettingsSchema = z.object({
  localProject: localProjectSettingsSchema,
  project: projectSettingsSchema,
  tasks: taskSettingsSchema,
  runtimeAutoApproveDefaults: runtimeAutoApproveDefaultsSchema,
  runtimePermissionModes: runtimePermissionModesSchema,
  automations: automationsSettingsSchema,
  issueWorker: issueWorkerSettingsSchema,
  kanban: kanbanSettingsSchema,
  maas: maasSettingsSchema,
  llm: globalLlmSettingsSchema,
  modelProviders: modelProviderSettingsSchema,
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
  updates: updatesSettingsSchema,
  mobileSync: mobileSyncSettingsSchema,
});
