import type { Issue } from './tasks';

export type IssueProviderType = Issue['provider'];

export type IssueProviderCapabilities = {
  requiresProjectPath: boolean;
  requiresRepositoryUrl: boolean;
};

export const ISSUE_PROVIDER_CAPABILITIES: Record<IssueProviderType, IssueProviderCapabilities> = {
  linear: {
    requiresProjectPath: false,
    requiresRepositoryUrl: false,
  },
  github: {
    requiresProjectPath: false,
    requiresRepositoryUrl: true,
  },
  jira: {
    requiresProjectPath: false,
    requiresRepositoryUrl: false,
  },
  gitlab: {
    requiresProjectPath: true,
    requiresRepositoryUrl: false,
  },
  forgejo: {
    requiresProjectPath: true,
    requiresRepositoryUrl: false,
  },
  featurebase: {
    requiresProjectPath: false,
    requiresRepositoryUrl: false,
  },
  plain: {
    requiresProjectPath: false,
    requiresRepositoryUrl: false,
  },
  asana: {
    requiresProjectPath: false,
    requiresRepositoryUrl: false,
  },
  monday: {
    requiresProjectPath: false,
    requiresRepositoryUrl: false,
  },
  trello: {
    requiresProjectPath: false,
    requiresRepositoryUrl: false,
  },
  plane: {
    requiresProjectPath: false,
    requiresRepositoryUrl: false,
  },
  notion: {
    requiresProjectPath: false,
    requiresRepositoryUrl: false,
  },
  feishu: {
    requiresProjectPath: false,
    requiresRepositoryUrl: false,
  },
};

export type ConnectionStatus = {
  connected: boolean;
  displayName?: string;
  error?: string;
  capabilities: IssueProviderCapabilities;
};

export type ConnectionStatusMap = Record<IssueProviderType, ConnectionStatus>;

export type IssueListResult =
  | { success: true; issues: Issue[] }
  | { success: false; error: string };
