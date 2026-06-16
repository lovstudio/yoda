import { Copy, Crown, Plus, Trash2, Users, X } from 'lucide-react';
import { useState } from 'react';
import { isBuiltinTeamId, type AgentTeam, type AgentTeamMember } from '@shared/agent-team';
import { getRuntime, RUNTIMES } from '@shared/runtime-registry';
import { useAgents } from '@renderer/features/agents-config/use-agents';
import { cn } from '@renderer/utils/utils';
import { useAgentTeams } from './use-agent-teams';

type Editing = { name: string; icon: string; members: AgentTeamMember[] } | null;

export function AgentTeamsMainPanel() {
  const { teams, create, update, remove, duplicate } = useAgentTeams();
  const { agents } = useAgents();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Editing>(null);

  const isNew = selectedId === '__new__';
  // Effective selection falls back to the first team (no setState-in-effect).
  const effectiveId = isNew ? null : (selectedId ?? teams[0]?.id ?? null);
  const selected = teams.find((t) => t.id === effectiveId) ?? null;
  const isBuiltin = selected ? isBuiltinTeamId(selected.id) : false;

  const startNew = () => {
    setSelectedId('__new__');
    setDraft({ name: '', icon: '👥', members: [] });
  };
  const startEdit = (team: AgentTeam) => {
    setSelectedId(team.id);
    setDraft({ name: team.name, icon: team.icon, members: team.members.map((m) => ({ ...m })) });
  };

  const save = async () => {
    if (!draft) return;
    if (isNew) await create(draft);
    else if (selected) await update({ id: selected.id, draft });
    setDraft(null);
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-background text-foreground">
      {/* team list */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-background-secondary">
        <div className="flex items-center justify-between px-3 py-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
            Teams
          </span>
          <button
            type="button"
            onClick={startNew}
            title="New team"
            className="flex size-6 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {isNew && (
            <div className="flex items-center gap-2 rounded-md bg-primary/10 px-2.5 py-2 text-sm text-primary">
              <Users className="size-4 shrink-0" />
              <span className="flex-1 truncate">New team…</span>
            </div>
          )}
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => {
                setSelectedId(team.id);
                setDraft(null);
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                team.id === effectiveId && !isNew
                  ? 'bg-background-2 text-foreground'
                  : 'text-foreground-muted hover:bg-background-2 hover:text-foreground'
              )}
            >
              <span className="text-base leading-none">{team.icon}</span>
              <span className="min-w-0 flex-1 truncate">{team.name}</span>
              {isBuiltinTeamId(team.id) && (
                <span className="shrink-0 text-[10px] text-foreground-muted">built-in</span>
              )}
            </button>
          ))}
        </div>
      </aside>

      {/* editor / viewer */}
      <section className="flex min-w-0 flex-1 flex-col overflow-y-auto p-6">
        {draft ? (
          <TeamEditor
            draft={draft}
            agents={agents}
            onChange={setDraft}
            onSave={() => void save()}
            onCancel={() => setDraft(null)}
          />
        ) : selected ? (
          <div className="mx-auto w-full max-w-lg">
            <div className="mb-4 flex items-center gap-3">
              <span className="text-2xl">{selected.icon}</span>
              <h2 className="flex-1 text-lg font-semibold">{selected.name}</h2>
              {isBuiltin ? (
                <button
                  type="button"
                  onClick={() => duplicate(selected.id)}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-background-1 px-2.5 py-1.5 text-xs transition-colors hover:bg-background-2"
                >
                  <Copy className="size-3.5" /> Duplicate to edit
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => startEdit(selected)}
                    className="rounded-md border border-border bg-background-1 px-2.5 py-1.5 text-xs transition-colors hover:bg-background-2"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void remove(selected.id);
                      setSelectedId(null);
                    }}
                    title="Delete team"
                    className="flex size-7 items-center justify-center rounded-md border border-border text-foreground-muted transition-colors hover:border-red-500 hover:text-red-500"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </>
              )}
            </div>
            <MemberList members={selected.members} />
            {isBuiltin && (
              <p className="mt-3 text-xs text-foreground-muted">
                Built-in teams are read-only. Duplicate to customize members & runtimes.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-foreground-muted">
            Select a team, or create one.
          </div>
        )}
      </section>
    </div>
  );
}

function MemberList({ members }: { members: AgentTeamMember[] }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-background-1 p-2">
      {members.map((m) => (
        <div key={m.handle} className="flex items-center gap-2 px-1.5 py-1.5 text-sm">
          <span className="min-w-0 flex-1 truncate">{m.displayName}</span>
          {m.role === 'leader' && (
            <span className="flex items-center gap-1 rounded bg-primary/15 px-1.5 py-px text-[10px] text-primary">
              <Crown className="size-3" /> leader
            </span>
          )}
          <span className="font-mono text-[11px] text-foreground-muted">
            {getRuntime(m.runtime)?.name ?? m.runtime}
          </span>
        </div>
      ))}
      {members.length === 0 && (
        <p className="px-2 py-3 text-center text-xs text-foreground-muted">No members yet.</p>
      )}
    </div>
  );
}

function TeamEditor({
  draft,
  agents,
  onChange,
  onSave,
  onCancel,
}: {
  draft: NonNullable<Editing>;
  agents: ReturnType<typeof useAgents>['agents'];
  onChange: (d: NonNullable<Editing>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const runtimeOptions = RUNTIMES.filter((r) => r.terminalOnly);
  const setMembers = (members: AgentTeamMember[]) => onChange({ ...draft, members });

  const addAgent = (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return;
    const member: AgentTeamMember = {
      handle: agent.slug,
      displayName: agent.name,
      role: draft.members.length === 0 ? 'leader' : 'worker',
      runtime: agent.preferredRuntime ?? 'claude',
      agentRef: agent.id,
    };
    setMembers([...draft.members, member]);
  };

  const setLeader = (handle: string) =>
    setMembers(
      draft.members.map((m) => ({ ...m, role: m.handle === handle ? 'leader' : 'worker' }))
    );

  const canSave = draft.name.trim().length > 0 && draft.members.length > 0;
  const usedAgentRefs = new Set(draft.members.map((m) => m.agentRef));

  return (
    <div className="mx-auto w-full max-w-lg">
      <h2 className="mb-4 text-lg font-semibold">Team</h2>
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <input
            value={draft.icon}
            onChange={(e) => onChange({ ...draft, icon: e.target.value })}
            className="w-14 rounded-md border border-border bg-background-1 px-3 py-2 text-center text-lg outline-none focus:border-primary/60"
            aria-label="Team icon"
          />
          <input
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            placeholder="Team name (e.g. My review duo)"
            className="flex-1 rounded-md border border-border bg-background-1 px-3 py-2 text-sm outline-none focus:border-primary/60"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-foreground-muted">
            Members — pick the leader (runs first, then hands off)
          </span>
          <div className="flex flex-col gap-1 rounded-lg border border-border bg-background-1 p-2">
            {draft.members.map((m) => (
              <div key={m.handle} className="flex items-center gap-2 px-1 py-1 text-sm">
                <button
                  type="button"
                  onClick={() => setLeader(m.handle)}
                  title="Make leader"
                  className={cn(
                    'flex size-6 items-center justify-center rounded-md border transition-colors',
                    m.role === 'leader'
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-border text-foreground-muted hover:text-foreground'
                  )}
                >
                  <Crown className="size-3.5" />
                </button>
                <span className="min-w-0 flex-1 truncate">{m.displayName}</span>
                <select
                  value={m.runtime}
                  onChange={(e) =>
                    setMembers(
                      draft.members.map((x) =>
                        x.handle === m.handle
                          ? { ...x, runtime: e.target.value as typeof x.runtime }
                          : x
                      )
                    )
                  }
                  className="rounded-md border border-border bg-background-2 px-2 py-1 text-xs outline-none"
                >
                  {runtimeOptions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setMembers(draft.members.filter((x) => x.handle !== m.handle))}
                  className="flex size-6 items-center justify-center rounded-md text-foreground-muted hover:text-red-500"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            {draft.members.length === 0 && (
              <p className="px-2 py-2 text-center text-xs text-foreground-muted">
                Add agents from your library below.
              </p>
            )}
          </div>
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) addAgent(e.target.value);
            }}
            className="rounded-md border border-border bg-background-1 px-3 py-2 text-sm outline-none focus:border-primary/60"
          >
            <option value="">+ Add agent…</option>
            {agents
              .filter((a) => !usedAgentRefs.has(a.id))
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.icon} {a.name}
                </option>
              ))}
          </select>
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border bg-background-1 px-3 py-2 text-sm transition-colors hover:bg-background-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
          >
            Save team
          </button>
        </div>
      </div>
    </div>
  );
}
