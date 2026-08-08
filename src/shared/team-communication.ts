export const TEAM_COMMUNICATION_MODES = [
  'process',
  'message-hub',
  'shared-file',
  'github',
] as const;

export type TeamCommunicationMode = (typeof TEAM_COMMUNICATION_MODES)[number];

export type TeamCommunicationConfig = {
  /** Where agents leave the durable body of their work. */
  mode: TeamCommunicationMode;
  /** Whether agent updates are mirrored into the human-facing room timeline. */
  syncToRoom: boolean;
  /** Worktree-relative coordination artifact used by shared-file mode. */
  sharedFilePath: string;
  /** Optional repository override. Empty means the project's primary GitHub remote. */
  githubRepository: string;
  /** Optional issue and pull request watched by the local GitHub monitor. */
  githubIssueNumber: number | null;
  githubPullRequestNumber: number | null;
};

export const DEFAULT_TEAM_SHARED_FILE_PATH = '.yoda/team/shared-handoff.md';

export const DEFAULT_TEAM_COMMUNICATION_CONFIG: TeamCommunicationConfig = {
  mode: 'message-hub',
  syncToRoom: true,
  sharedFilePath: DEFAULT_TEAM_SHARED_FILE_PATH,
  githubRepository: '',
  githubIssueNumber: null,
  githubPullRequestNumber: null,
};

function normalizePositiveInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeTeamCommunicationConfig(
  value?: Partial<TeamCommunicationConfig> | null
): TeamCommunicationConfig {
  const mode = TEAM_COMMUNICATION_MODES.includes(value?.mode as TeamCommunicationMode)
    ? (value?.mode as TeamCommunicationMode)
    : DEFAULT_TEAM_COMMUNICATION_CONFIG.mode;
  const candidatePath = value?.sharedFilePath?.trim().replace(/^\/+/, '');
  const sharedFilePath =
    candidatePath &&
    !candidatePath
      .split(/[\\/]+/)
      .some((segment) => segment === '..' || segment === '.' || segment.length === 0)
      ? candidatePath
      : DEFAULT_TEAM_SHARED_FILE_PATH;
  return {
    mode,
    syncToRoom: value?.syncToRoom ?? DEFAULT_TEAM_COMMUNICATION_CONFIG.syncToRoom,
    sharedFilePath: sharedFilePath || DEFAULT_TEAM_SHARED_FILE_PATH,
    githubRepository: value?.githubRepository?.trim() ?? '',
    githubIssueNumber: normalizePositiveInteger(value?.githubIssueNumber),
    githubPullRequestNumber: normalizePositiveInteger(value?.githubPullRequestNumber),
  };
}

export type TeamMemberObservation = {
  memberId: string;
  mode: TeamCommunicationMode;
  runtimeStatus: 'idle' | 'waiting' | 'running' | 'finished' | 'error' | 'awaiting-input';
  processId: number | null;
  processStatus: 'busy' | 'idle' | 'waiting' | null;
  transcriptPath: string | null;
  sharedFilePath: string | null;
  sharedFileExists: boolean;
  sharedFileUpdatedAt: string | null;
  githubIssueUrl: string | null;
  githubPullRequestUrl: string | null;
  githubMonitorState: GitHubRoomMonitorState['state'] | null;
  githubLastCheckedAt: string | null;
  githubMonitorError: string | null;
  updatedAt: string;
};

export type GitHubRoomMonitorState = {
  roomId: string;
  state: 'disabled' | 'idle' | 'polling' | 'error';
  repository: string | null;
  issueUpdatedAt: string | null;
  pullRequestUpdatedAt: string | null;
  lastCheckedAt: string | null;
  nextPollAt: string | null;
  lastError: string | null;
};
