import { describe, expect, it } from 'vitest';
import { normalizeTeamHandle, parseMentions } from './team-room';

describe('Team Room handles', () => {
  it('normalizes the @-prefixed spelling emitted by Agent prompts', () => {
    expect(normalizeTeamHandle('@builtinreview-implementer')).toBe('builtinreview-implementer');
    expect(normalizeTeamHandle('@@Planner-Agent ')).toBe('planner-agent');
  });

  it('parses handles in the same canonical form used for routing', () => {
    expect(parseMentions('@Planner-Agent hand this to @implementer')).toEqual([
      'planner-agent',
      'implementer',
    ]);
  });
});
