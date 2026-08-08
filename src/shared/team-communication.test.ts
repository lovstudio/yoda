import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEAM_COMMUNICATION_CONFIG,
  normalizeTeamCommunicationConfig,
} from './team-communication';

describe('normalizeTeamCommunicationConfig', () => {
  it('keeps the compatible message-hub defaults for existing rooms', () => {
    expect(normalizeTeamCommunicationConfig()).toEqual(DEFAULT_TEAM_COMMUNICATION_CONFIG);
  });

  it('normalizes GitHub work item numbers', () => {
    expect(
      normalizeTeamCommunicationConfig({
        mode: 'github',
        syncToRoom: false,
        githubRepository: ' lovstudio/yoda ',
        githubIssueNumber: 42,
        githubPullRequestNumber: -1,
      })
    ).toMatchObject({
      mode: 'github',
      syncToRoom: false,
      githubRepository: 'lovstudio/yoda',
      githubIssueNumber: 42,
      githubPullRequestNumber: null,
    });
  });

  it('keeps shared hand-offs inside the worktree', () => {
    expect(
      normalizeTeamCommunicationConfig({
        mode: 'shared-file',
        sharedFilePath: '../../outside.md',
      }).sharedFilePath
    ).toBe(DEFAULT_TEAM_COMMUNICATION_CONFIG.sharedFilePath);
    expect(
      normalizeTeamCommunicationConfig({
        mode: 'shared-file',
        sharedFilePath: 'docs/team/handoff.md',
      }).sharedFilePath
    ).toBe('docs/team/handoff.md');
  });
});
