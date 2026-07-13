import { describe, expect, it } from 'vitest';
import { BUILTIN_FEATURE_TEAM_ID, BUILTIN_TEAMS, teamLeader, teamWorkers } from './agent-team';
import { hasFeatureWorkflowContract } from './feature-workflow';

describe('built-in Feature team', () => {
  it('maps the six workflow stages to one lead and five ordered workers', () => {
    const team = BUILTIN_TEAMS.find((candidate) => candidate.id === BUILTIN_FEATURE_TEAM_ID);

    expect(team).toBeDefined();
    expect(team?.routing).toBe('sequential');
    expect(team?.members.map((member) => member.handle)).toEqual([
      'orchestrator',
      'product-design',
      'engineering',
      'quality',
      'feature-docs',
      'launch-docs',
    ]);
    expect(teamLeader(team!)?.handle).toBe('orchestrator');
    expect(teamWorkers(team!)).toHaveLength(5);
    expect(team?.members.every((member) => member.systemPrompt?.includes('[FEATURE:'))).toBe(true);
    expect(hasFeatureWorkflowContract(team!)).toBe(true);
    const editableCopy = { ...team!, id: 'copy-of-feature' };
    expect(hasFeatureWorkflowContract(editableCopy)).toBe(true);
    expect(hasFeatureWorkflowContract({ ...team!, members: [...team!.members].reverse() })).toBe(
      false
    );
    expect(
      hasFeatureWorkflowContract({
        ...team!,
        members: team!.members.map((member) => ({
          ...member,
          role: member.handle === 'product-design' ? 'leader' : 'worker',
        })),
      })
    ).toBe(false);
  });
});
