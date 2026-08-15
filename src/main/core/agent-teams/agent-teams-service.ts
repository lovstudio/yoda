import type { AgentTeam } from '@shared/agent-team';
import { paradigmToTeam } from '@shared/paradigms/team-adapter';
import { paradigmsService } from '@main/core/paradigms/paradigms-service';

/**
 * Agent Teams, as seen by the team-room code.
 *
 * Teams are stored as `team`-kind paradigm instances — a team always *was* an
 * instance of the multi-agent paradigm, it just predated the vocabulary and got
 * its own table. This is the adapter that keeps `AgentTeam` as the vocabulary for
 * `team-rooms/`, which cares about rosters and routing rather than paradigms.
 *
 * Ids carry across unchanged, so rooms keep resolving their team.
 *
 * Read-only: a roster is created and edited as a paradigm instance, in the
 * multi-agent paradigm's own configuration panel. There is no separate collection
 * of teams to write to any more, so there is nothing here to write with.
 */
class AgentTeamsService {
  async get(id: string): Promise<AgentTeam | null> {
    const paradigm = await paradigmsService.get(id);
    // A non-team instance answering to this id is not a team, and returning it as
    // one would hand the room orchestrator an empty roster.
    if (!paradigm || paradigm.kindId !== 'team') return null;
    return paradigmToTeam(paradigm);
  }
}

export const agentTeamsService = new AgentTeamsService();
