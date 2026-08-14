import { describe, expect, it } from 'vitest';
import type { AgentTeamMember } from '../agent-team';
import { teamParadigmParamsSchema } from './params';

/**
 * `runtime` is deliberately widened to `string`: these stand for values already
 * on disk, which is exactly where a runtime id the registry has since dropped
 * comes from. Typing it as `RuntimeId` would make that case unwritable.
 */
function member(
  overrides: Partial<Omit<AgentTeamMember, 'runtime'>> & { runtime?: string }
): AgentTeamMember {
  return {
    handle: 'lead',
    displayName: 'Lead',
    role: 'leader',
    runtime: 'claude',
    ...overrides,
  } as AgentTeamMember;
}

/**
 * A team's roster is the one paradigm param that is irreplaceable user data, and
 * an unparseable params blob falls back to the kind's defaults — whose roster is
 * empty. So these cases are about data loss, not validation ergonomics.
 */
describe('team paradigm params', () => {
  it('repairs a member the runtime registry no longer knows instead of dropping the roster', () => {
    const parsed = teamParadigmParamsSchema.parse({
      routing: 'sequential',
      communication: {},
      routingHopLimit: 100,
      members: [member({}), member({ handle: 'worker', role: 'worker', runtime: 'retired-cli' })],
    });

    expect(parsed.members).toHaveLength(2);
    expect(parsed.members[1].runtime).toBe('claude');
  });

  it('keeps exactly one leader however many the input declares', () => {
    const two = teamParadigmParamsSchema.parse({
      routing: 'freeform',
      communication: {},
      routingHopLimit: null,
      members: [
        member({ handle: 'a' }),
        member({ handle: 'b' }),
        member({ handle: 'c', role: 'worker' }),
      ],
    });
    expect(two.members.map((m) => m.role)).toEqual(['leader', 'worker', 'worker']);

    const none = teamParadigmParamsSchema.parse({
      routing: 'freeform',
      communication: {},
      routingHopLimit: null,
      members: [member({ handle: 'a', role: 'worker' }), member({ handle: 'b', role: 'worker' })],
    });
    expect(none.members.map((m) => m.role)).toEqual(['leader', 'worker']);
  });

  it('disambiguates colliding handles, since a handle is how members address each other', () => {
    const parsed = teamParadigmParamsSchema.parse({
      routing: 'freeform',
      communication: {},
      routingHopLimit: null,
      members: [member({ handle: 'Dev' }), member({ handle: 'dev', role: 'worker' })],
    });
    expect(new Set(parsed.members.map((m) => m.handle)).size).toBe(2);
  });

  it('fills unreadable routing, hop limit, and communication from their defaults', () => {
    const parsed = teamParadigmParamsSchema.parse({
      routing: 'made-up',
      communication: { mode: 'made-up', sharedFilePath: '../escape' },
      routingHopLimit: -3,
      members: [],
    });

    expect(parsed.routing).toBe('freeform');
    expect(parsed.communication.mode).toBe('message-hub');
    expect(parsed.communication.sharedFilePath).toBe('.yoda/team/shared-handoff.md');
    expect(parsed.routingHopLimit).toBe(100);
  });
});
