import type { GitHubRoomMonitorState } from '@shared/team-communication';

export type WatchedGitHubResource = {
  updatedAt: string | null;
  etag: string | null;
};

export function shouldPublishGitHubUpdate(
  previous: GitHubRoomMonitorState,
  issue: WatchedGitHubResource | null,
  pullRequest: WatchedGitHubResource | null
): boolean {
  return (
    previous.lastCheckedAt !== null &&
    ((issue?.updatedAt ?? null) !== previous.issueUpdatedAt ||
      (pullRequest?.updatedAt ?? null) !== previous.pullRequestUpdatedAt)
  );
}
