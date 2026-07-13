import { Copy, Crown, Plus, Trash2, Users, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isBuiltinTeamId,
  type AgentTeam,
  type AgentTeamMember,
  type TeamRouting,
} from '@shared/agent-team';
import type { Agent } from '@shared/agents';
import { BUILTIN_AGENT_PRESETS } from '@shared/builtin-agents';
import { RUNTIMES } from '@shared/runtime-registry';
import {
  DEFAULT_ROUTING_HOP_LIMIT,
  normalizeRoutingHopLimit,
  type RoutingHopLimit,
} from '@shared/team-routing-limit';
import { useAgents } from '@renderer/features/agents-config/use-agents';
import { AgentCard } from '@renderer/lib/components/agent-card/agent-card';
import { AgentMetaRow } from '@renderer/lib/components/agent-card/agent-meta-row';
import { AgentInfoHover } from '@renderer/lib/components/agent-slot/agent-info-card';
import { AvatarInput, type AvatarFileError } from '@renderer/lib/components/avatar-input';
import { avatarDisplayText, AvatarValue } from '@renderer/lib/components/avatar-value';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { cn } from '@renderer/utils/utils';
import { useAgentTeams } from './use-agent-teams';

/**
 * Resolve a team member to a full Agent for the card UI — a user Agent by id,
 * a built-in preset by `builtin:*` key, or an inline-prompt fallback. The
 * member's runtime (the slot override) wins over the source Agent's preferred
 * runtime, so the card reflects what actually runs.
 */
function resolveMemberAgent(member: AgentTeamMember, agents: Agent[]): Agent | null {
  let base: Pick<
    Agent,
    | 'name'
    | 'description'
    | 'icon'
    | 'systemPrompt'
    | 'enabledSkillIds'
    | 'manualSkillIds'
    | 'model'
  > | null = null;
  if (member.agentRef) {
    const user = agents.find((a) => a.id === member.agentRef);
    if (user) base = user;
    else {
      const preset = BUILTIN_AGENT_PRESETS.find((p) => p.key === member.agentRef);
      if (preset)
        base = {
          name: preset.name,
          description: preset.description,
          icon: preset.icon,
          systemPrompt: preset.systemPrompt,
          enabledSkillIds: [],
          manualSkillIds: [],
          model: null,
        };
    }
  }
  if (!base && member.systemPrompt) {
    base = {
      name: member.displayName,
      description: '',
      icon: member.icon ?? '🤖',
      systemPrompt: member.systemPrompt,
      enabledSkillIds: [],
      manualSkillIds: [],
      model: null,
    };
  }
  if (!base) return null;
  return {
    id: member.agentRef ?? member.handle,
    slug: member.handle,
    name: base.name,
    description: base.description,
    icon: base.icon,
    systemPrompt: base.systemPrompt,
    enabledSkillIds: base.enabledSkillIds,
    manualSkillIds: base.manualSkillIds,
    preferredRuntime: member.runtime,
    model: base.model,
    source: 'local',
    createdAt: '',
    updatedAt: '',
  };
}

/**
 * Card row for one team member, shared by the read-only roster and the editor.
 * Shows the resolved Agent's identity + (optional) runtime + skills, with the
 * full Agent detail on hover. `trailing` carries editor controls.
 */
function MemberCard({
  member,
  agents,
  showRuntime = true,
  leaderBadge = true,
  trailing,
}: {
  member: AgentTeamMember;
  agents: Agent[];
  showRuntime?: boolean;
  leaderBadge?: boolean;
  trailing?: ReactNode;
}) {
  const resolved = resolveMemberAgent(member, agents);
  const skillCount = resolved
    ? resolved.enabledSkillIds.length + resolved.manualSkillIds.length
    : 0;

  const card = (
    <AgentCard
      name={member.displayName}
      icon={resolved?.icon}
      description={resolved?.description || undefined}
      badges={
        leaderBadge && member.role === 'leader' ? (
          <span className="flex shrink-0 items-center gap-1 rounded bg-primary/15 px-1.5 py-px text-[10px] text-primary">
            <Crown className="size-3" /> leader
          </span>
        ) : undefined
      }
      footer={
        showRuntime ? (
          <AgentMetaRow className="mt-0.5" runtime={member.runtime} skillCount={skillCount} />
        ) : undefined
      }
      trailing={trailing}
    />
  );

  return resolved ? <AgentInfoHover agent={resolved}>{card}</AgentInfoHover> : card;
}

type Editing = {
  name: string;
  icon: string;
  routing: TeamRouting;
  routingHopLimit: RoutingHopLimit;
  members: AgentTeamMember[];
} | null;

const ROUTING_LABEL_KEYS: Record<TeamRouting, string> = {
  'review-loop': 'agentTeams.routing.reviewLoop',
  'fan-out': 'agentTeams.routing.fanOut',
  sequential: 'agentTeams.routing.sequential',
  freeform: 'agentTeams.routing.freeform',
};

function formatRoutingHopLimit(limit: RoutingHopLimit): string {
  return limit === null ? 'Unlimited routing steps' : `${limit} routing steps per prompt`;
}

export function AgentTeamsMainPanel() {
  const { t } = useTranslation();
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
    setDraft({
      name: '',
      icon: '👥',
      routing: 'freeform',
      routingHopLimit: DEFAULT_ROUTING_HOP_LIMIT,
      members: [],
    });
  };
  const startEdit = (team: AgentTeam) => {
    setSelectedId(team.id);
    setDraft({
      name: team.name,
      icon: team.icon,
      routing: team.routing,
      routingHopLimit: team.routingHopLimit,
      members: team.members.map((m) => ({ ...m })),
    });
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
              <AvatarValue
                name={team.name}
                value={team.icon}
                className="size-5 rounded-md text-xs"
              />
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
              <AvatarValue
                name={selected.name}
                value={selected.icon}
                className="size-9 rounded-lg text-lg"
              />
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
            <p className="mb-1 text-xs text-foreground-muted">
              {t(ROUTING_LABEL_KEYS[selected.routing])}
            </p>
            <p className="mb-2 text-xs text-foreground-passive">
              {formatRoutingHopLimit(selected.routingHopLimit)}
            </p>
            <MemberList members={selected.members} agents={agents} />
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

function MemberList({ members, agents }: { members: AgentTeamMember[]; agents: Agent[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      {members.map((m) => (
        <MemberCard key={m.handle} member={m} agents={agents} />
      ))}
      {members.length === 0 && (
        <p className="rounded-lg border border-border bg-background-1 px-2 py-3 text-center text-xs text-foreground-muted">
          No members yet.
        </p>
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
  const { t } = useTranslation();
  const { toast } = useToast();
  const runtimeOptions = RUNTIMES.filter((r) => r.terminalOnly);
  const setMembers = (members: AgentTeamMember[]) => onChange({ ...draft, members });
  const showAvatarFileError = (error: AvatarFileError) => {
    const key =
      error === 'too-large'
        ? 'common.avatarFileTooLarge'
        : error === 'unsupported'
          ? 'common.avatarUnsupported'
          : 'common.avatarReadFailed';
    toast({ title: t(key), variant: 'destructive' });
  };

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
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <AvatarInput
            id="agent-team-avatar"
            name={draft.name}
            value={draft.icon}
            onChange={(icon) => onChange({ ...draft, icon })}
            inputLabel="Team avatar"
            placeholder={t('common.avatarPlaceholder')}
            uploadTitle={t('common.uploadPhoto')}
            clearTitle={t('common.clearAvatar')}
            onFileError={showAvatarFileError}
          />
          <input
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            placeholder="Team name (e.g. My review duo)"
            className="flex-1 rounded-md border border-border bg-background-1 px-3 py-2 text-sm outline-none focus:border-primary/60"
          />
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-foreground-muted">Collaboration</span>
          <select
            value={draft.routing}
            onChange={(e) => onChange({ ...draft, routing: e.target.value as TeamRouting })}
            className="rounded-md border border-border bg-background-1 px-3 py-2 text-sm outline-none focus:border-primary/60"
          >
            {(Object.keys(ROUTING_LABEL_KEYS) as TeamRouting[]).map((r) => (
              <option key={r} value={r}>
                {t(ROUTING_LABEL_KEYS[r])}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-foreground-muted">Routing limit</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              step={1}
              disabled={draft.routingHopLimit === null}
              value={draft.routingHopLimit ?? ''}
              onChange={(e) =>
                onChange({
                  ...draft,
                  routingHopLimit: normalizeRoutingHopLimit(Number(e.target.value)),
                })
              }
              className="min-w-0 flex-1 rounded-md border border-border bg-background-1 px-3 py-2 text-sm outline-none focus:border-primary/60 disabled:opacity-50"
            />
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-foreground-muted">
              <input
                type="checkbox"
                checked={draft.routingHopLimit === null}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    routingHopLimit: e.target.checked ? null : DEFAULT_ROUTING_HOP_LIMIT,
                  })
                }
              />
              Unlimited
            </span>
          </div>
          <span className="text-[11px] text-foreground-passive">
            Max agent deliveries per human prompt.
          </span>
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-foreground-muted">
            Members — pick the leader (runs first, then hands off)
          </span>
          <div className="flex flex-col gap-1.5">
            {draft.members.map((m) => (
              <MemberCard
                key={m.handle}
                member={m}
                agents={agents}
                showRuntime={false}
                leaderBadge={false}
                trailing={
                  <div className="flex shrink-0 items-center gap-1.5">
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
                }
              />
            ))}
            {draft.members.length === 0 && (
              <p className="rounded-lg border border-border bg-background-1 px-2 py-2 text-center text-xs text-foreground-muted">
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
                  {avatarDisplayText(a.name, a.icon)} {a.name}
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
