import { isBuiltinTeamId, type AgentTeam, type AgentTeamDraft } from '@shared/agent-team';
import { paradigmToTeam, teamToParadigmDraft } from '@shared/paradigms/team-adapter';
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
 */
class AgentTeamsService {
  /** Built-in templates first, then user teams (most-recently-updated first). */
  async list(): Promise<AgentTeam[]> {
    const instances = await paradigmsService.list();
    return instances
      .filter((paradigm) => paradigm.kindId === 'team')
      .map((paradigm) => paradigmToTeam(paradigm));
  }

  async get(id: string): Promise<AgentTeam | null> {
    const paradigm = await paradigmsService.get(id);
    // A non-team instance answering to this id is not a team, and returning it as
    // one would hand the room orchestrator an empty roster.
    if (!paradigm || paradigm.kindId !== 'team') return null;
    return paradigmToTeam(paradigm);
  }

  async create(draft: AgentTeamDraft): Promise<AgentTeam> {
    return paradigmToTeam(await paradigmsService.create(teamToParadigmDraft(draft)));
  }

  async update(id: string, draft: AgentTeamDraft): Promise<AgentTeam> {
    if (isBuiltinTeamId(id))
      throw new Error('Built-in teams cannot be edited; duplicate it first.');
    return paradigmToTeam(await paradigmsService.update(id, teamToParadigmDraft(draft)));
  }

  async remove(id: string): Promise<void> {
    if (isBuiltinTeamId(id)) throw new Error('Built-in teams cannot be removed.');
    await paradigmsService.remove(id);
  }

  /** Duplicate any team (built-in or user) into an editable user team. */
  async duplicate(id: string): Promise<AgentTeam> {
    const source = await this.get(id);
    if (!source) throw new Error(`Team ${id} not found`);
    return this.create({
      name: `${source.name} copy`,
      icon: source.icon,
      routing: source.routing,
      routingHopLimit: source.routingHopLimit,
      communication: source.communication,
      members: source.members,
    });
  }
}

export const agentTeamsService = new AgentTeamsService();
