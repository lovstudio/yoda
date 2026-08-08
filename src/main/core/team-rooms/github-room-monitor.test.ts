import { describe, expect, it } from 'vitest';
import type { GitHubRoomMonitorState } from '@shared/team-communication';
import { shouldPublishGitHubUpdate } from './github-room-monitor-state';

const baseline: GitHubRoomMonitorState = {
  roomId: 'room-1',
  state: 'idle',
  repository: 'lovstudio/yoda',
  issueUpdatedAt: '2026-08-08T01:00:00.000Z',
  pullRequestUpdatedAt: '2026-08-08T02:00:00.000Z',
  lastCheckedAt: '2026-08-08T02:01:00.000Z',
  nextPollAt: null,
  lastError: null,
};

describe('GitHub room monitor change detection', () => {
  it('does not wake the room during its initial baseline read', () => {
    expect(
      shouldPublishGitHubUpdate(
        { ...baseline, lastCheckedAt: null },
        { updatedAt: '2026-08-08T01:00:00.000Z', etag: 'issue' },
        { updatedAt: '2026-08-08T02:00:00.000Z', etag: 'pull' }
      )
    ).toBe(false);
  });

  it('wakes the room only when a watched timestamp changes', () => {
    expect(
      shouldPublishGitHubUpdate(
        baseline,
        { updatedAt: baseline.issueUpdatedAt, etag: 'issue' },
        { updatedAt: baseline.pullRequestUpdatedAt, etag: 'pull' }
      )
    ).toBe(false);
    expect(
      shouldPublishGitHubUpdate(
        baseline,
        { updatedAt: '2026-08-08T03:00:00.000Z', etag: 'issue-2' },
        { updatedAt: baseline.pullRequestUpdatedAt, etag: 'pull' }
      )
    ).toBe(true);
  });

  it('does not treat an unconfigured resource as a change', () => {
    expect(
      shouldPublishGitHubUpdate(
        { ...baseline, pullRequestUpdatedAt: null },
        { updatedAt: baseline.issueUpdatedAt, etag: 'issue' },
        null
      )
    ).toBe(false);
  });
});
