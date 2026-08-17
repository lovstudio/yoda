import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_MOBILE_SYNC_MODE } from '@lovstudio/yoda-protocol/mobile-sync';
import type { AppSettings, AppSettingsKey } from '@shared/app-settings';
import {
  createDefaultLlmProfile,
  DEFAULT_LLM_PROFILE_ID,
  DEFAULT_LLM_PROFILE_NAME,
} from '@shared/global-llm';
import { MAAS_PLATFORMS } from '@shared/maas';
import { DEFAULT_NOTIFICATION_CENTER_SOURCES } from '@shared/notifications';
import type { OpenInAppId } from '@shared/openInApps';
import {
  DEFAULT_SUMMARY_CONTEXT_GLOBAL,
  DEFAULT_SUMMARY_CONTEXT_RECENT,
} from '@shared/session-summary';
import { DEFAULT_TASK_APPEARANCE_SETTINGS } from '@shared/task-appearance';
import {
  DEFAULT_TASK_NAMING_CONTEXT,
  DEFAULT_TASK_NAMING_MODEL,
  DEFAULT_TASK_NAMING_RECENT_TASK_LIMIT,
  DEFAULT_TASK_NAMING_TIMEOUT_MS,
} from '@shared/task-naming';
import {
  DEFAULT_HOT_TERMINAL_LIMIT,
  DEFAULT_IDLE_SESSION_TIMEOUT_MINUTES,
  DEFAULT_TERMINAL_CACHE_MODE,
  DEFAULT_TERMINAL_LINK_OPEN,
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
} from '@shared/terminal-settings';
import { getDefaultLocalWorktreeDirectory } from './worktree-defaults';

export const DEFAULT_RUNTIME_ID = 'claude';

type SettingsDefaultsMap = {
  [K in AppSettingsKey]: AppSettings[K] | (() => AppSettings[K]);
};

export const SETTINGS_DEFAULTS = {
  project: {
    pushOnCreate: true,
    createBranchAndWorktree: true,
    branchPrefix: 'yoda',
    tmuxByDefault: true,
  },
  localProject: () => ({
    defaultProjectsDirectory: join(homedir(), 'Yoda', 'repositories'),
    worktreeLocationMode: 'central' as const,
    defaultWorktreeDirectory: getDefaultLocalWorktreeDirectory(),
    writeAgentConfigToGitIgnore: true,
  }),
  tasks: {
    workspacesEnabled: false,
    autoGenerateName: true,
    initTaskNameFromSession: true,
    branchNaming: 'hash' as const,
    namingAgentId: '',
    promptRewriteAgentId: '',
    autoGenerateSummary: true,
    summaryAgentId: '',
    // `skip` here is not "off" — the prompt-rewrite switch is
    // `promptRewriteEnabled`. It stays as the stored default only so that switch,
    // which has no default of its own, still infers "off" for users who never set
    // it. See resolvePromptRewriteEnabled.
    inputPromptLanguage: 'skip' as const,
    summaryLanguage: 'app' as const,
    summaryContextRecent: DEFAULT_SUMMARY_CONTEXT_RECENT,
    summaryContextGlobal: DEFAULT_SUMMARY_CONTEXT_GLOBAL,
    namingModel: DEFAULT_TASK_NAMING_MODEL,
    namingLanguage: 'app' as const,
    namingContext: DEFAULT_TASK_NAMING_CONTEXT,
    namingRecentTaskLimit: DEFAULT_TASK_NAMING_RECENT_TASK_LIMIT,
    namingRequestTimeoutMs: DEFAULT_TASK_NAMING_TIMEOUT_MS,
    autoTrustWorktrees: true,
  },
  runtimeAutoApproveDefaults: {},
  runtimePermissionModes: {},
  automations: {
    items: [],
  },
  issueWorker: {
    projects: {},
  },
  kanban: {
    hooksByStatus: {},
  },
  maas: {
    selectedPlatformId: MAAS_PLATFORMS.zenmux.id,
    connections: [],
    runtimeBindings: [],
    externalAgentSyncEnabled: false,
    externalAgentSyncLoginItemEnabled: true,
  },
  llm: {
    profiles: [
      createDefaultLlmProfile({
        id: DEFAULT_LLM_PROFILE_ID,
        name: DEFAULT_LLM_PROFILE_NAME,
      }),
    ],
    defaultProfileId: DEFAULT_LLM_PROFILE_ID,
    namingProfileId: DEFAULT_LLM_PROFILE_ID,
    imageGenerationProfileId: DEFAULT_LLM_PROFILE_ID,
  },
  modelProviders: {
    automaticUpdatesEnabled: true,
    lastAutomaticRefreshAt: null,
    providers: {},
    catalogCache: {
      official: {},
      aggregate: {
        models: [],
        fetchedAt: null,
        lastAttemptAt: null,
      },
    },
  },
  runtimeModelCandidates: {
    runtimes: {},
  },
  notifications: {
    enabled: true,
    sound: true,
    osNotifications: true,
    soundFocusMode: 'unfocused' as const,
    accountUsageWarningEnabled: true,
    accountUsageWarningThreshold: 95,
    notificationCenterSources: DEFAULT_NOTIFICATION_CENTER_SOURCES,
  },
  terminal: {
    autoCopyOnSelection: true,
    linkOpen: { ...DEFAULT_TERMINAL_LINK_OPEN, fileRules: [] },
    scrollbackLines: DEFAULT_TERMINAL_SCROLLBACK_LINES,
    hotTerminalMode: DEFAULT_TERMINAL_CACHE_MODE,
    hotTerminalLimit: DEFAULT_HOT_TERMINAL_LIMIT,
    idleSessionTimeoutMinutes: DEFAULT_IDLE_SESSION_TIMEOUT_MINUTES,
  },
  // Fresh installs boot into the brand theme; null = explicit follow-system.
  theme: 'ygreen' as const,
  systemThemes: {
    light: 'ylight' as const,
    dark: 'ydark' as const,
  },
  customThemes: {
    items: [],
  },
  defaultRuntime: DEFAULT_RUNTIME_ID,
  keyboard: {},
  openIn: {
    default: 'terminal' as const,
    hidden: [] as OpenInAppId[],
  },
  interface: {
    taskHoverAction: 'delete' as const,
    autoRightSidebarBehavior: false,
    sidebarStatusBarPrimary: 'product' as const,
    newTaskOpenMode: 'home' as const,
    agentReplyDisplayLevel: 'concise' as const,
    sessionShareDisplayLevel: 'concise' as const,
    dockSessionHistory: true,
    dockSessionHistoryRows: 3,
    taskAppearance: DEFAULT_TASK_APPEARANCE_SETTINGS,
  },
  browserPreview: {
    enabled: true,
  },
  homeDraft: {
    prompt: '',
    selectedProjectId: null,
    strategyKind: 'new-branch' as const,
    baseBranch: null,
    runtimeOverride: null,
    runMode: 'normal' as const,
    selectedParadigmId: '',
    agentSystemPrompts: {},
    selectedAgentIds: {},
    expressMode: false,
    attachImagesAsPaths: false,
    facetId: null,
    promptTokens: [],
    preArchiveCommand: '',
  },
  statusline: {
    templates: [
      {
        id: 'model-dir',
        name: 'Model + Dir',
        command:
          'input=$(cat); echo "[$(echo "$input" | jq -r \'.model.display_name\')] $(basename "$(echo "$input" | jq -r \'.workspace.current_dir\')")"',
      },
      {
        id: 'model-git',
        name: 'Model + Git Branch',
        command:
          'input=$(cat); dir=$(echo "$input" | jq -r \'.workspace.current_dir\'); branch=$(git -C "$dir" branch --show-current 2>/dev/null); echo "[$(echo "$input" | jq -r \'.model.display_name\')] $(basename "$dir")${branch:+ ($branch)}"',
      },
      {
        id: 'ccusage',
        name: 'ccusage',
        command: 'npx -y ccusage statusline',
      },
    ],
  },
  promptPrinciples: {
    items: [],
  },
  updates: {
    source: 'official' as const,
    proxyMode: 'auto' as const,
    proxyUrl: '',
  },
  mobileSync: {
    mode: DEFAULT_MOBILE_SYNC_MODE,
  },
} satisfies SettingsDefaultsMap;

export function getDefaultForKey<K extends AppSettingsKey>(key: K): AppSettings[K] {
  const d = SETTINGS_DEFAULTS[key];
  return (typeof d === 'function' ? (d as () => AppSettings[K])() : d) as AppSettings[K];
}
