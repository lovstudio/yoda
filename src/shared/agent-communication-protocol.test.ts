import { describe, expect, it } from 'vitest';
import { buildMemberTurnPrompt, buildTeammateSystemPrompt } from './agent-communication-protocol';
import { normalizeTeamCommunicationConfig } from './team-communication';

const member = {
  displayName: 'Builder',
  handle: 'builder',
  roster: [{ handle: 'lead', displayName: 'Lead', role: 'leader' }],
};

describe('agent communication protocol', () => {
  it('lets process-observed agents finish without copying work to the room', () => {
    const prompt = buildTeammateSystemPrompt({
      ...member,
      communication: normalizeTeamCommunicationConfig({
        mode: 'process',
        syncToRoom: false,
      }),
    });
    expect(prompt).toContain('finish your turn normally');
    expect(prompt).toContain('do not need to copy your work into the room');
    expect(prompt).toContain('Do not create or use client-native subagents');
    expect(prompt).toContain('If routing fails, report that failure and stop');
  });

  it('points shared-file turns to the configured artifact', () => {
    const communication = normalizeTeamCommunicationConfig({
      mode: 'shared-file',
      sharedFilePath: 'docs/handoff.md',
    });
    expect(buildTeammateSystemPrompt({ ...member, communication })).toContain('docs/handoff.md');
    expect(
      buildMemberTurnPrompt({ fromDisplayName: 'Lead', body: 'Continue.', communication })
    ).toContain('Read docs/handoff.md before continuing.');
  });

  it('uses GitHub work items as the durable coordination record', () => {
    const prompt = buildTeammateSystemPrompt({
      ...member,
      communication: normalizeTeamCommunicationConfig({
        mode: 'github',
        githubRepository: 'lovstudio/yoda',
        githubIssueNumber: 12,
        githubPullRequestNumber: 34,
      }),
    });
    expect(prompt).toContain('lovstudio/yoda issue #12 pull request #34');
    expect(prompt).toContain('durable coordination record');
  });
});
