import z from 'zod';
import { AGENT_MODEL_CANDIDATE_SOURCES } from '@shared/agent-model-candidates';
import { AGENT_PROVIDER_IDS, AGENT_PROVIDERS } from '@shared/agent-provider-registry';
import { customThemeSelectionSchema, customThemesSettingsSchema } from '@shared/custom-theme';
import { MAAS_PLATFORM_IDS } from '@shared/maas';
import { openInAppIdSchema } from '@shared/openInApps';
import { quickActionSchema } from '@shared/project-settings';
import {
  DEFAULT_TASK_NAMING_RECENT_TASK_LIMIT,
  DEFAULT_TASK_NAMING_TIMEOUT_MS,
  TASK_NAMING_CONTEXT_SOURCE_IDS,
} from '@shared/task-naming';
import {
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  MAX_TERMINAL_SCROLLBACK_LINES,
  MIN_TERMINAL_SCROLLBACK_LINES,
} from '@shared/terminal-settings';
import { DEFAULT_AGENT_ID, DEFAULT_REVIEW_PROMPT } from './settings-registry';

export const projectSettingsSchema = z.object({
  pushOnCreate: z.boolean(),
  createBranchAndWorktree: z.boolean(),
  branchPrefix: z.string(),
  tmuxByDefault: z.boolean(),
});

export const localProjectSettingsSchema = z.object({
  defaultProjectsDirectory: z.string(),
  defaultWorktreeDirectory: z.string(),
  writeAgentConfigToGitIgnore: z.boolean(),
});

export const notificationSettingsSchema = z.object({
  enabled: z.boolean(),
  sound: z.boolean(),
  osNotifications: z.boolean(),
  soundFocusMode: z.enum(['always', 'unfocused']),
});

export const taskSettingsSchema = z.object({
  autoGenerateName: z.boolean(),
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
    .min(3_000)
    .max(60_000)
    .catch(DEFAULT_TASK_NAMING_TIMEOUT_MS),
  autoTrustWorktrees: z.boolean(),
});

export const agentAutoApproveDefaultsSchema = z
  .partialRecord(z.enum(AGENT_PROVIDER_IDS), z.boolean())
  .default({});

export const automationStatusSchema = z.enum(['active', 'paused']);

export const automationEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  workspaceName: z.string(),
  prompt: z.string(),
  provider: z.enum(AGENT_PROVIDER_IDS),
  scheduleLabel: z.string(),
  status: automationStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  lastRunAt: z.string().nullable(),
});

export const automationsSettingsSchema = z.object({
  items: z.array(automationEntrySchema),
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

export const agentModelCandidateCacheEntrySchema = z.object({
  source: z.enum(AGENT_MODEL_CANDIDATE_SOURCES),
  models: z.array(z.string()),
  fetchedAt: z.string(),
  expiresAt: z.string(),
  error: z.string().optional(),
});

export const agentModelCandidateProviderSettingsSchema = z.preprocess(
  (value) => (Array.isArray(value) ? { sources: value, hiddenModels: [] } : value),
  z.object({
    sources: z.array(agentModelCandidateCacheEntrySchema).default([]),
    hiddenModels: z.array(z.string()).default([]),
  })
);

export const agentModelCandidatesSettingsSchema = z.object({
  providers: z
    .partialRecord(z.enum(AGENT_PROVIDER_IDS), agentModelCandidateProviderSettingsSchema)
    .default({}),
});

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

const legacyThemeSchema = z.enum(['ylight', 'ydark', 'emlight', 'emdark']).transform((value) => {
  if (value === 'emlight') return 'ylight' as const;
  if (value === 'emdark') return 'ydark' as const;
  return value;
});

export const themeSchema = z
  .union([legacyThemeSchema, customThemeSelectionSchema])
  .nullable()
  .catch(null)
  .optional()
  .default(null);

export const defaultAgentSchema = z.optional(z.enum(AGENT_PROVIDER_IDS)).default(DEFAULT_AGENT_ID);

export const reviewPromptSchema = z.string().default(DEFAULT_REVIEW_PROMPT);

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

export const providerCustomConfigEntrySchema = z.object({
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

export const providerConfigDefaults = Object.fromEntries(
  AGENT_PROVIDERS.filter(
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
});

export const browserPreviewSettingsSchema = z.object({ enabled: z.boolean() });

const homeRunModeSchema = z.enum(['normal', 'brainstorm', 'compare', 'review', 'team']);
const teamProviderSelectionSchema = z.object({
  ceo: z.enum(AGENT_PROVIDER_IDS),
  product: z.enum(AGENT_PROVIDER_IDS),
  engineering: z.enum(AGENT_PROVIDER_IDS),
  uiux: z.enum(AGENT_PROVIDER_IDS),
  operations: z.enum(AGENT_PROVIDER_IDS),
});

export const homeDraftSchema = z.object({
  prompt: z.string(),
  selectedProjectId: z.string().nullable(),
  strategyKind: z.enum(['new-branch', 'no-worktree']),
  reviewStrategyKind: z.enum(['new-branch', 'no-worktree']),
  providerOverride: z.enum(AGENT_PROVIDER_IDS).nullable(),
  runMode: homeRunModeSchema,
  compareProviders: z.array(z.enum(AGENT_PROVIDER_IDS)),
  reviewReviewerProvider: z.enum(AGENT_PROVIDER_IDS),
  teamProviders: teamProviderSelectionSchema,
  agentSystemPrompts: z.record(z.string(), z.string().nullable()),
  /** Selected user-defined Agent ids per run mode. Keyed by HomeRunMode; the
   *  value is an array (single-element for solo modes, multiple for team). An
   *  empty/absent entry means "use the raw runtime", preserving native behavior. */
  selectedAgentIds: z.record(z.string(), z.array(z.string())),
  /** When true, the sidebar "+" button creates a task immediately using the
   *  last home-draft agent runtime config instead of opening the home view. */
  expressMode: z.boolean(),
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
});

export const openInSettingsSchema = z.object({
  default: openInAppIdSchema,
  hidden: z.array(openInAppIdSchema),
});

export const APP_SETTINGS_SCHEMA_MAP = {
  localProject: localProjectSettingsSchema,
  project: projectSettingsSchema,
  tasks: taskSettingsSchema,
  agentAutoApproveDefaults: agentAutoApproveDefaultsSchema,
  automations: automationsSettingsSchema,
  maas: maasSettingsSchema,
  agentModelCandidates: agentModelCandidatesSettingsSchema,
  defaultAgent: defaultAgentSchema,
  reviewPrompt: reviewPromptSchema,
  keyboard: keyboardSettingsSchema,
  notifications: notificationSettingsSchema,
  theme: themeSchema,
  openIn: openInSettingsSchema,
  interface: interfaceSettingsSchema,
  terminal: terminalSettingsSchema,
  customThemes: customThemesSettingsSchema,
  browserPreview: browserPreviewSettingsSchema,
  homeDraft: homeDraftSchema,
} as const;

export const appSettingsSchema = z.object({
  localProject: localProjectSettingsSchema,
  project: projectSettingsSchema,
  tasks: taskSettingsSchema,
  agentAutoApproveDefaults: agentAutoApproveDefaultsSchema,
  automations: automationsSettingsSchema,
  maas: maasSettingsSchema,
  agentModelCandidates: agentModelCandidatesSettingsSchema,
  defaultAgent: defaultAgentSchema,
  reviewPrompt: reviewPromptSchema,
  keyboard: keyboardSettingsSchema,
  notifications: notificationSettingsSchema,
  theme: themeSchema,
  openIn: openInSettingsSchema,
  interface: interfaceSettingsSchema,
  terminal: terminalSettingsSchema,
  customThemes: customThemesSettingsSchema,
  browserPreview: browserPreviewSettingsSchema,
  homeDraft: homeDraftSchema,
});
