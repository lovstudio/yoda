import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AppSettings, AppSettingsKey } from '@shared/app-settings';
import { MAAS_PLATFORMS } from '@shared/maas';
import type { OpenInAppId } from '@shared/openInApps';
import {
  DEFAULT_SUMMARY_CONTEXT_GLOBAL,
  DEFAULT_SUMMARY_CONTEXT_RECENT,
} from '@shared/session-summary';
import {
  DEFAULT_TASK_NAMING_CONTEXT,
  DEFAULT_TASK_NAMING_MODEL,
  DEFAULT_TASK_NAMING_RECENT_TASK_LIMIT,
  DEFAULT_TASK_NAMING_TIMEOUT_MS,
} from '@shared/task-naming';
import { DEFAULT_TERMINAL_SCROLLBACK_LINES } from '@shared/terminal-settings';
import { getDefaultLocalWorktreeDirectory } from './worktree-defaults';

export const DEFAULT_RUNTIME_ID = 'claude';
export const DEFAULT_REVIEW_PROMPT =
  'Review all changes in this worktree. Focus on correctness, regressions, edge cases, and missing tests. List concrete issues first, then note residual risks.';

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
    defaultProjectsDirectory: join(homedir(), 'yoda', 'repositories'),
    defaultWorktreeDirectory: getDefaultLocalWorktreeDirectory(),
    writeAgentConfigToGitIgnore: true,
  }),
  tasks: {
    autoGenerateName: true,
    namingAgentId: '',
    summaryAgentId: '',
    summaryLanguage: 'app' as const,
    statusBarSource: 'summary' as const,
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
  automations: {
    items: [],
  },
  maas: {
    selectedPlatformId: MAAS_PLATFORMS.zenmux.id,
    connections: [],
  },
  runtimeModelCandidates: {
    runtimes: {},
  },
  notifications: {
    enabled: true,
    sound: true,
    osNotifications: true,
    soundFocusMode: 'always' as const,
  },
  terminal: {
    autoCopyOnSelection: true,
    scrollbackLines: DEFAULT_TERMINAL_SCROLLBACK_LINES,
  },
  theme: null,
  customThemes: {
    items: [],
  },
  defaultRuntime: DEFAULT_RUNTIME_ID,
  reviewPrompt: DEFAULT_REVIEW_PROMPT,
  keyboard: {},
  openIn: {
    default: 'terminal' as const,
    hidden: [] as OpenInAppId[],
  },
  interface: {
    taskHoverAction: 'delete' as const,
    autoRightSidebarBehavior: false,
  },
  browserPreview: {
    enabled: true,
  },
  homeDraft: {
    prompt: '',
    selectedProjectId: null,
    strategyKind: 'new-branch' as const,
    reviewStrategyKind: 'no-worktree' as const,
    runtimeOverride: null,
    runMode: 'normal' as const,
    compareRuntimes: ['claude', 'codex'],
    reviewReviewerRuntime: 'claude' as const,
    teamRuntimes: {
      ceo: 'claude' as const,
      product: 'claude' as const,
      engineering: 'codex' as const,
      uiux: 'claude' as const,
      operations: 'codex' as const,
    },
    agentSystemPrompts: {},
    selectedAgentIds: {},
    expressMode: false,
    attachImagesAsPaths: false,
    promptTokens: [],
    preArchiveCommand: '',
    defaultQuickActions: [{ id: 'release', label: 'Release', command: '/release-via-cicd' }],
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
} satisfies SettingsDefaultsMap;

export function getDefaultForKey<K extends AppSettingsKey>(key: K): AppSettings[K] {
  const d = SETTINGS_DEFAULTS[key];
  return (typeof d === 'function' ? (d as () => AppSettings[K])() : d) as AppSettings[K];
}
