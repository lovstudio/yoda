import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import {
  BUILTIN_TEAMS,
  isBuiltinTeamId,
  type AgentTeam,
  type AgentTeamDraft,
  type AgentTeamMember,
  type TeamRouting,
} from '@shared/agent-team';
import { isValidRuntimeId } from '@shared/runtime-registry';
import { normalizeRoutingHopLimit } from '@shared/team-routing-limit';
import { db } from '@main/db/client';
import { agentTeams, type AgentTeamRow } from '@main/db/schema';

const ROUTINGS: TeamRouting[] = ['review-loop', 'fan-out', 'sequential', 'freeform'];

function rowToTeam(row: AgentTeamRow): AgentTeam {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    routing: ROUTINGS.includes(row.routing as TeamRouting)
      ? (row.routing as TeamRouting)
      : 'freeform',
    routingHopLimit: normalizeRoutingHopLimit(row.routingHopLimit),
    builtin: false,
    members: Array.isArray(row.members) ? row.members : [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Normalize members: valid runtime, non-empty handle, exactly one leader. */
function sanitizeMembers(members: AgentTeamMember[]): AgentTeamMember[] {
  const seen = new Set<string>();
  const clean = members
    .map((m, i) => {
      let handle = (m.handle || `member-${i + 1}`).toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (!handle) handle = `member-${i + 1}`;
      while (seen.has(handle)) handle = `${handle}-${i + 1}`;
      seen.add(handle);
      return {
        handle,
        displayName: m.displayName.trim() || handle,
        icon: m.icon?.trim() || undefined,
        role: m.role === 'leader' ? 'leader' : 'worker',
        runtime: isValidRuntimeId(m.runtime) ? m.runtime : 'claude',
        agentRef: m.agentRef,
        systemPrompt: m.systemPrompt,
      } satisfies AgentTeamMember;
    })
    .filter(Boolean);
  // Force exactly one leader.
  const leaderIdx = clean.findIndex((m) => m.role === 'leader');
  return clean.map((m, i) => ({
    ...m,
    role: i === (leaderIdx === -1 ? 0 : leaderIdx) ? 'leader' : 'worker',
  }));
}

function sanitizeDraft(draft: AgentTeamDraft): AgentTeamDraft {
  return {
    name: draft.name.trim() || 'Untitled team',
    icon: draft.icon.trim() || '👥',
    routing: ROUTINGS.includes(draft.routing) ? draft.routing : 'freeform',
    routingHopLimit: normalizeRoutingHopLimit(draft.routingHopLimit),
    members: sanitizeMembers(draft.members),
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
      members: source.members,
    });
  }
}

export const agentTeamsService = new AgentTeamsService();
