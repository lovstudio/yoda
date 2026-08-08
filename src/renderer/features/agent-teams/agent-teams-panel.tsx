import { Copy, Crown, Pencil, Plus, Trash2, UserPlus, Users, X } from 'lucide-react';
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
import {
  DEFAULT_TEAM_COMMUNICATION_CONFIG,
  TEAM_COMMUNICATION_MODES,
  type TeamCommunicationConfig,
  type TeamCommunicationMode,
} from '@shared/team-communication';
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
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { cn } from '@renderer/utils/utils';
import { useAgentTeams } from './use-agent-teams';

/**
 * Resolve a team member to a full Agent for the card UI — a user Agent by id,
 * a built-in Agent by stable slug, or an inline-prompt fallback. Referenced
 * Agents keep their own client setting; inline roles retain the team runtime.
 */
function findReferencedAgent(member: AgentTeamMember, agents: Agent[]): Agent | null {
  if (!member.agentRef) return null;
  return (
    agents.find((agent) =>
      member.agentRef?.startsWith('builtin:')
        ? agent.slug === member.agentRef
        : agent.id === member.agentRef
    ) ?? null
  );
}

function resolveMemberAgent(member: AgentTeamMember, agents: Agent[]): Agent | null {
  let base: Pick<
    Agent,
    | 'name'
    | 'description'
    | 'icon'
    | 'systemPrompt'
    | 'enabledSkillIds'
    | 'manualSkillIds'
    | 'skillPolicyMode'
    | 'model'
    | 'preferredRuntime'
  > | null = null;
  if (member.agentRef) {
    const user = findReferencedAgent(member, agents);
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
          skillPolicyMode: 'runtime-defaults',
          model: null,
          preferredRuntime: preset.preferredRuntime,
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
      skillPolicyMode: 'runtime-defaults',
      model: null,
      preferredRuntime: member.runtime,
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
    skillPolicyMode: base.skillPolicyMode,
    preferredRuntime: base.preferredRuntime,
    model: base.model,
    reasoningEffort: null,
    accessMode: 'inherit',
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
  communication: TeamCommunicationConfig;
  members: AgentTeamMember[];
} | null;

const ROUTING_LABEL_KEYS: Record<TeamRouting, string> = {
  'review-loop': 'agentTeams.routing.reviewLoop',
  'fan-out': 'agentTeams.routing.fanOut',
  sequential: 'agentTeams.routing.sequential',
  freeform: 'agentTeams.routing.freeform',
};

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
      communication: { ...DEFAULT_TEAM_COMMUNICATION_CONFIG },
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
      communication: { ...team.communication },
      members: team.members.map((m) => ({ ...m })),
    });
  };

  const save = async () => {
    if (!draft) return;
    if (isNew) {
      const created = await create(draft);
      setSelectedId(created.id);
    } else if (selected) {
      await update({ id: selected.id, draft });
    }
    setDraft(null);
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-background text-foreground">
      {/* team list */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-background-secondary">
        <div className="flex items-center justify-between px-3 py-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
            {t('agentTeams.title')}
          </span>
          <button
            type="button"
            onClick={startNew}
            title={t('agentTeams.newTeam')}
            aria-label={t('agentTeams.newTeam')}
            className="flex size-6 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {isNew && (
            <div className="flex items-center gap-2 rounded-md bg-primary/10 px-2.5 py-2 text-sm text-primary">
              <Users className="size-4 shrink-0" />
              <span className="flex-1 truncate">{t('agentTeams.newTeamDraft')}</span>
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
                <span className="shrink-0 text-[10px] text-foreground-muted">
                  {t('agentTeams.builtin')}
                </span>
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
            isNew={isNew}
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
                  <Copy className="size-3.5" /> {t('agentTeams.duplicateToEdit')}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => startEdit(selected)}
                    className="rounded-md border border-border bg-background-1 px-2.5 py-1.5 text-xs transition-colors hover:bg-background-2"
                  >
                    {t('common.edit')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void remove(selected.id);
                      setSelectedId(null);
                    }}
                    title={t('agentTeams.deleteTeam')}
                    aria-label={t('agentTeams.deleteTeam')}
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
            <p className="mb-1 text-xs text-foreground-muted">
              {t(`agentTeams.communicationModes.${selected.communication.mode}.label`)}
            </p>
            <p className="mb-2 text-xs text-foreground-passive">
              {selected.routingHopLimit === null
                ? t('agentTeams.routingUnlimited')
                : t('agentTeams.routingSteps', { count: selected.routingHopLimit })}
            </p>
            <MemberList members={selected.members} agents={agents} />
            {isBuiltin && (
              <p className="mt-3 text-xs text-foreground-muted">{t('agentTeams.readOnlyHint')}</p>
            )}
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-foreground-muted">
            {t('agentTeams.selectTeam')}
          </div>
        )}
      </section>
    </div>
  );
}

function MemberList({ members, agents }: { members: AgentTeamMember[]; agents: Agent[] }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5">
      {members.map((m) => (
        <MemberCard key={m.handle} member={m} agents={agents} />
      ))}
      {members.length === 0 && (
        <p className="rounded-lg border border-border bg-background-1 px-2 py-3 text-center text-xs text-foreground-muted">
          {t('agentTeams.noMembers')}
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
  isNew,
}: {
  draft: NonNullable<Editing>;
  agents: ReturnType<typeof useAgents>['agents'];
  onChange: (d: NonNullable<Editing>) => void;
  onSave: () => void;
  onCancel: () => void;
  isNew: boolean;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const showAgentModal = useShowModal('agentEditModal');
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
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

  const addAgent = (agent: Agent) => {
    if (draft.members.some((member) => member.agentRef === agent.id)) return;
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
  const availableAgents = agents.filter((agent) => !usedAgentRefs.has(agent.id));

  return (
    <div className="mx-auto w-full max-w-lg">
      <h2 className="mb-4 text-lg font-semibold">
        {t(isNew ? 'agentTeams.newTeam' : 'agentTeams.editTeam')}
      </h2>
      <div className="flex flex-col gap-3">
        <div className="flex items-end gap-3 rounded-xl border border-border bg-muted/15 p-3">
          <AvatarInput
            id="agent-team-avatar"
            name={draft.name}
            value={draft.icon}
            onChange={(icon) => onChange({ ...draft, icon })}
            inputLabel={t('agentTeams.teamAvatar')}
            placeholder={t('common.avatarPlaceholder')}
            uploadTitle={t('common.uploadPhoto')}
            clearTitle={t('common.clearAvatar')}
            onFileError={showAvatarFileError}
            appearance="profile"
          />
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor="agent-team-name" className="text-xs">
              {t('agentTeams.teamName')}
              <span className="ml-0.5 text-destructive" aria-hidden>
                *
              </span>
            </Label>
            <Input
              id="agent-team-name"
              required
              aria-required="true"
              value={draft.name}
              onChange={(e) => onChange({ ...draft, name: e.target.value })}
              placeholder={t('agentTeams.teamNamePlaceholder')}
              className="text-sm"
            />
          </div>
        </div>

        <section className="space-y-3 rounded-xl border border-border bg-muted/10 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs">{t('agentTeams.collaboration')}</Label>
              <Select
                modal={false}
                value={draft.routing}
                onValueChange={(value) => onChange({ ...draft, routing: value as TeamRouting })}
              >
                <SelectTrigger className="h-9 w-full text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROUTING_LABEL_KEYS) as TeamRouting[]).map((routing) => (
                    <SelectItem key={routing} value={routing}>
                      {t(ROUTING_LABEL_KEYS[routing])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">{t('agentTeams.communicationMode')}</Label>
              <Select
                modal={false}
                value={draft.communication.mode}
                onValueChange={(mode) =>
                  onChange({
                    ...draft,
                    communication: {
                      ...draft.communication,
                      mode: mode as TeamCommunicationMode,
                    },
                  })
                }
              >
                <SelectTrigger
                  className="h-9 w-full text-sm"
                  aria-label={t('agentTeams.communicationMode')}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEAM_COMMUNICATION_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {t(`agentTeams.communicationModes.${mode}.label`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="agent-team-routing-limit"
                className="text-xs"
                title={t('agentTeams.routingLimitHint')}
              >
                {t('agentTeams.routingLimit')}
              </Label>
              <div className="flex h-9 items-center gap-2">
                <Input
                  id="agent-team-routing-limit"
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
                  className="h-9 min-w-0 flex-1 text-sm"
                />
                <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-foreground-muted">
                  <Checkbox
                    checked={draft.routingHopLimit === null}
                    onCheckedChange={(checked) =>
                      onChange({
                        ...draft,
                        routingHopLimit: checked ? null : DEFAULT_ROUTING_HOP_LIMIT,
                      })
                    }
                  />
                  {t('agentTeams.unlimited')}
                </label>
              </div>
            </div>

            <label
              className="flex h-9 cursor-pointer items-center gap-2 self-end rounded-md border border-border bg-background/40 px-2.5"
              title={t('agentTeams.syncToRoomHint')}
            >
              <Checkbox
                checked={draft.communication.syncToRoom}
                onCheckedChange={(checked) =>
                  onChange({
                    ...draft,
                    communication: { ...draft.communication, syncToRoom: checked === true },
                  })
                }
              />
              <span className="text-xs font-medium">{t('agentTeams.syncToRoom')}</span>
            </label>
          </div>

          <p className="text-[10px] leading-relaxed text-muted-foreground">
            {t(`agentTeams.communicationModes.${draft.communication.mode}.description`)}
          </p>

          {draft.communication.mode === 'shared-file' ? (
            <div className="space-y-2">
              <Label htmlFor="agent-team-shared-file" className="text-xs">
                {t('agentTeams.sharedFilePath')}
              </Label>
              <Input
                id="agent-team-shared-file"
                value={draft.communication.sharedFilePath}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    communication: {
                      ...draft.communication,
                      sharedFilePath: event.target.value,
                    },
                  })
                }
                className="font-mono text-xs"
              />
            </div>
          ) : null}

          {draft.communication.mode === 'github' ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2 sm:col-span-3">
                <Label htmlFor="agent-team-github-repository" className="text-xs">
                  {t('agentTeams.githubRepository')}
                </Label>
                <Input
                  id="agent-team-github-repository"
                  value={draft.communication.githubRepository}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      communication: {
                        ...draft.communication,
                        githubRepository: event.target.value,
                      },
                    })
                  }
                  placeholder={t('agentTeams.githubRepositoryPlaceholder')}
                  className="font-mono text-xs"
                />
              </div>
              <CommunicationNumberField
                id="agent-team-github-issue"
                label={t('agentTeams.githubIssue')}
                value={draft.communication.githubIssueNumber}
                onChange={(githubIssueNumber) =>
                  onChange({
                    ...draft,
                    communication: { ...draft.communication, githubIssueNumber },
                  })
                }
              />
              <CommunicationNumberField
                id="agent-team-github-pr"
                label={t('agentTeams.githubPullRequest')}
                value={draft.communication.githubPullRequestNumber}
                onChange={(githubPullRequestNumber) =>
                  onChange({
                    ...draft,
                    communication: { ...draft.communication, githubPullRequestNumber },
                  })
                }
              />
              <p className="self-end pb-2 text-[10px] leading-relaxed text-muted-foreground">
                {t('agentTeams.githubPollingHint')}
              </p>
            </div>
          ) : null}
        </section>

        <section
          aria-labelledby="agent-team-members-label"
          aria-describedby="agent-team-members-hint"
          className="space-y-3 rounded-xl border border-border bg-muted/10 p-3"
        >
          <div className="space-y-1">
            <Label id="agent-team-members-label" className="text-xs">
              {t('agentTeams.members')}
              <span className="ml-0.5 text-destructive" aria-hidden>
                *
              </span>
            </Label>
            <p id="agent-team-members-hint" className="text-[10px] text-muted-foreground">
              {t('agentTeams.membersHint')}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            {draft.members.map((m) => {
              const referencedAgent = findReferencedAgent(m, agents);
              return (
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
                        title={t('agentTeams.makeLeader')}
                        aria-label={t('agentTeams.makeLeader')}
                        className={cn(
                          'flex size-6 items-center justify-center rounded-md border transition-colors',
                          m.role === 'leader'
                            ? 'border-primary bg-primary/15 text-primary'
                            : 'border-border text-foreground-muted hover:text-foreground'
                        )}
                      >
                        <Crown className="size-3.5" />
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={!referencedAgent}
                        title={t('agentManager.editAgent')}
                        onClick={() => {
                          if (!referencedAgent) return;
                          showAgentModal({
                            agent: referencedAgent,
                            onSuccess: (updatedAgent) =>
                              setMembers(
                                draft.members.map((member) =>
                                  member.handle === m.handle
                                    ? {
                                        ...member,
                                        displayName: updatedAgent.name,
                                        icon: updatedAgent.icon || undefined,
                                        runtime: updatedAgent.preferredRuntime ?? member.runtime,
                                      }
                                    : member
                                )
                              ),
                          });
                        }}
                      >
                        <Pencil className="size-3" />
                        {t('agentManager.editAgent')}
                      </Button>
                      <button
                        type="button"
                        onClick={() =>
                          setMembers(draft.members.filter((x) => x.handle !== m.handle))
                        }
                        aria-label={t('common.remove')}
                        className="flex size-6 items-center justify-center rounded-md text-foreground-muted hover:text-red-500"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  }
                />
              );
            })}
            {draft.members.length === 0 && (
              <div className="flex flex-col items-center gap-1 py-3 text-center text-foreground-muted">
                <Users className="size-5 opacity-50" />
                <p className="text-xs">{t('agentTeams.noMembers')}</p>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Select
              modal={false}
              open={memberPickerOpen}
              onOpenChange={setMemberPickerOpen}
              value={null}
              onValueChange={(agentId) => {
                const agent = agents.find((candidate) => candidate.id === agentId);
                if (agent) addAgent(agent);
                setMemberPickerOpen(false);
              }}
            >
              <SelectTrigger
                disabled={availableAgents.length === 0}
                className="h-9 min-w-0 flex-1 justify-start text-sm"
                aria-label={t('agentTeams.addAgent')}
              >
                <UserPlus className="size-3.5 text-foreground-muted" />
                <SelectValue
                  placeholder={
                    availableAgents.length > 0
                      ? t('agentTeams.addAgent')
                      : t('agentTeams.noAvailableAgents')
                  }
                />
              </SelectTrigger>
              <SelectContent
                align="start"
                alignItemWithTrigger={false}
                className="min-w-(--anchor-width)"
                style={{ maxHeight: '16rem' }}
              >
                {availableAgents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {avatarDisplayText(agent.name, agent.icon)} {agent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              className="h-9 shrink-0"
              onClick={() => showAgentModal({ onSuccess: addAgent })}
            >
              <Plus className="size-3.5" />
              {t('agentTeams.createAgent')}
            </Button>
          </div>
        </section>

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={onSave} disabled={!canSave}>
            {t('agentTeams.saveTeam')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CommunicationNumberField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        min={1}
        step={1}
        value={value ?? ''}
        onChange={(event) => {
          const next = Number(event.target.value);
          onChange(Number.isInteger(next) && next > 0 ? next : null);
        }}
        placeholder="#"
        className="text-sm"
      />
    </div>
  );
}
