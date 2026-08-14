import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import {
  BUILTIN_TEAMS,
  isBuiltinTeamId,
  normalizeTeamMembers,
  normalizeTeamRouting,
  type AgentTeam,
  type AgentTeamDraft,
} from '@shared/agent-team';
import { normalizeTeamCommunicationConfig } from '@shared/team-communication';
import { normalizeRoutingHopLimit } from '@shared/team-routing-limit';
import { db } from '@main/db/client';
import { agentTeams, type AgentTeamRow } from '@main/db/schema';

function rowToTeam(row: AgentTeamRow): AgentTeam {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    routing: normalizeTeamRouting(row.routing),
    routingHopLimit: normalizeRoutingHopLimit(row.routingHopLimit),
    communication: normalizeTeamCommunicationConfig(row.communication),
    builtin: false,
    members: normalizeTeamMembers(Array.isArray(row.members) ? row.members : []),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function sanitizeDraft(draft: AgentTeamDraft): AgentTeamDraft {
  return {
    name: draft.name.trim() || 'Untitled team',
    icon: draft.icon.trim() || '👥',
    routing: normalizeTeamRouting(draft.routing),
    communication: normalizeTeamCommunicationConfig(draft.communication),
    routingHopLimit: normalizeRoutingHopLimit(draft.routingHopLimit),
    members: normalizeTeamMembers(draft.members),
  };
}

class AgentTeamsService {
  /** Built-in templates first, then user teams (most-recently-updated first). */
  async list(): Promise<AgentTeam[]> {
    const rows = await db.select().from(agentTeams).orderBy(desc(agentTeams.updatedAt)).execute();
    return [...BUILTIN_TEAMS, ...rows.map(rowToTeam)];
  }

  async get(id: string): Promise<AgentTeam | null> {
    const builtin = BUILTIN_TEAMS.find((t) => t.id === id);
    if (builtin) return builtin;
    const [row] = await db.select().from(agentTeams).where(eq(agentTeams.id, id)).execute();
    return row ? rowToTeam(row) : null;
  }

  async create(draft: AgentTeamDraft): Promise<AgentTeam> {
    const clean = sanitizeDraft(draft);
    const id = randomUUID();
    await db
      .insert(agentTeams)
      .values({
        id,
        name: clean.name,
        icon: clean.icon,
        routing: clean.routing,
        routingHopLimit: clean.routingHopLimit,
        communication: clean.communication,
        members: clean.members,
      })
      .execute();
    const created = await this.get(id);
    if (!created) throw new Error('Failed to read back created team');
    return created;
  }

  async update(id: string, draft: AgentTeamDraft): Promise<AgentTeam> {
    if (isBuiltinTeamId(id))
      throw new Error('Built-in teams cannot be edited; duplicate it first.');
    const clean = sanitizeDraft(draft);
    await db
      .update(agentTeams)
      .set({
        name: clean.name,
        icon: clean.icon,
        routing: clean.routing,
        routingHopLimit: clean.routingHopLimit,
        communication: clean.communication,
        members: clean.members,
      })
      .where(eq(agentTeams.id, id))
      .execute();
    const updated = await this.get(id);
    if (!updated) throw new Error(`Team ${id} not found`);
    return updated;
  }

  async remove(id: string): Promise<void> {
    if (isBuiltinTeamId(id)) throw new Error('Built-in teams cannot be removed.');
    await db.delete(agentTeams).where(eq(agentTeams.id, id)).execute();
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
