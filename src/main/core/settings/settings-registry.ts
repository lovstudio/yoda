import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AppSettings, AppSettingsKey } from '@shared/app-settings';
import { MAAS_PLATFORMS } from '@shared/maas';
import type { OpenInAppId } from '@shared/openInApps';
import { getDefaultLocalWorktreeDirectory } from './worktree-defaults';

export const DEFAULT_AGENT_ID = 'claude';
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
    tmuxByDefault: false,
  },
  localProject: () => ({
    defaultProjectsDirectory: join(homedir(), 'yoda', 'repositories'),
    defaultWorktreeDirectory: getDefaultLocalWorktreeDirectory(),
    writeAgentConfigToGitIgnore: true,
  }),
  tasks: {
    autoGenerateName: true,
    autoTrustWorktrees: true,
  },
  agentAutoApproveDefaults: {},
  automations: {
    items: [],
  },
  maas: {
    selectedPlatformId: MAAS_PLATFORMS.zenmux.id,
    connections: [],
  },
  notifications: {
    enabled: true,
    sound: true,
    osNotifications: true,
    soundFocusMode: 'always' as const,
  },
  terminal: {
    autoCopyOnSelection: false,
  },
  theme: null,
  defaultAgent: DEFAULT_AGENT_ID,
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
    providerOverride: null,
    runMode: 'normal' as const,
    compareProviders: ['claude', 'codex'],
    reviewReviewerProvider: 'claude' as const,
    teamProviders: {
      ceo: 'claude' as const,
      product: 'claude' as const,
      engineering: 'codex' as const,
      uiux: 'claude' as const,
      operations: 'codex' as const,
    },
    agentSystemPrompts: {},
    expressMode: false,
    preArchiveCommand: '',
    defaultQuickActions: [{ id: 'release', label: 'Release', command: '/release-via-cicd' }],
  },
} satisfies SettingsDefaultsMap;

export function getDefaultForKey<K extends AppSettingsKey>(key: K): AppSettings[K] {
  const d = SETTINGS_DEFAULTS[key];
  return (typeof d === 'function' ? (d as () => AppSettings[K])() : d) as AppSettings[K];
}
