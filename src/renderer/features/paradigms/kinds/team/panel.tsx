import { ChevronDown, Crown, Pencil, Plus, Settings2, UserPlus, Users, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentTeam, AgentTeamMember, TeamRouting } from '@shared/agent-team';
import type { Agent } from '@shared/agents';
import { paradigmToTeam, teamToParadigmParams } from '@shared/paradigms/team-adapter';
import { TEAM_COMMUNICATION_MODES, type TeamCommunicationMode } from '@shared/team-communication';
import { DEFAULT_ROUTING_HOP_LIMIT, normalizeRoutingHopLimit } from '@shared/team-routing-limit';
import { avatarDisplayText } from '@renderer/lib/components/avatar-value';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@renderer/lib/ui/collapsible';
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
import type { ParadigmPanelProps } from '../../panel-context';
import { useParadigms } from '../../use-paradigms';
import { findReferencedAgent, MemberCard } from './member-card';

const ROUTING_LABEL_KEYS: Record<TeamRouting, string> = {
  'review-loop': 'agentTeams.routing.reviewLoop',
  'fan-out': 'agentTeams.routing.fanOut',
  sequential: 'agentTeams.routing.sequential',
  freeform: 'agentTeams.routing.freeform',
};

/**
 * The multi-agent paradigm's roster, edited in place.
 *
 * A team is not a thing the user has to create before they can work this way —
 * it is what this way of working is configured with, so the roster is edited
 * here rather than in a separate library of named teams. Every write lands in
 * the instance's own params, which is what keeps a duplicated paradigm's roster
 * its own.
 */
export function TeamParadigmPanel({ entry, agents, onConfigurationChange }: ParadigmPanelProps) {
  const { t } = useTranslation();
  const { paradigms, setParams } = useParadigms();
  const showAgentModal = useShowModal('agentEditModal');
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const paradigm = paradigms.find((candidate) => candidate.id === entry.id);
  // Nothing to configure until the instance loads. The panel is mounted from the
  // same query the picker lists from, so this is a first-paint gap, not a state.
  if (!paradigm) return null;
  const team = paradigmToTeam(paradigm);

  const write = (next: Partial<AgentTeam>) => {
    void setParams(entry.id, teamToParadigmParams({ ...team, ...next }));
    onConfigurationChange();
  };
  const setMembers = (members: AgentTeamMember[]) => write({ members });

  const addAgent = (agent: Agent) => {
    if (team.members.some((member) => member.agentRef === agent.id)) return;
    setMembers([
      ...team.members,
      {
        handle: agent.slug,
        displayName: agent.name,
        // The first one added leads, so a one-member team is already runnable.
        role: team.members.length === 0 ? 'leader' : 'worker',
        runtime: agent.preferredRuntime ?? 'claude',
        agentRef: agent.id,
      },
    ]);
  };

  const usedAgentRefs = new Set(team.members.map((member) => member.agentRef));
  const availableAgents = agents.filter((agent) => !usedAgentRefs.has(agent.id));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        {team.members.map((member) => {
          const referencedAgent = findReferencedAgent(member, agents);
          return (
            <MemberCard
              key={member.handle}
              member={member}
              agents={agents}
              showRuntime={false}
              leaderBadge={false}
              trailing={
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      setMembers(
                        team.members.map((candidate) => ({
                          ...candidate,
                          role: candidate.handle === member.handle ? 'leader' : 'worker',
                        }))
                      )
                    }
                    title={t('agentTeams.makeLeader')}
                    aria-label={t('agentTeams.makeLeader')}
                    aria-pressed={member.role === 'leader'}
                    className={cn(
                      'flex size-6 items-center justify-center rounded-md border transition-colors',
                      member.role === 'leader'
                        ? 'border-primary bg-primary/15 text-primary'
                        : 'border-border text-foreground-muted hover:text-foreground'
                    )}
                  >
                    <Crown className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={!referencedAgent}
                    title={t('agentManager.editAgent')}
                    aria-label={t('agentManager.editAgent')}
                    onClick={() => {
                      if (!referencedAgent) return;
                      showAgentModal({
                        agent: referencedAgent,
                        onSuccess: (updatedAgent) =>
                          setMembers(
                            team.members.map((candidate) =>
                              candidate.handle === member.handle
                                ? {
                                    ...candidate,
                                    displayName: updatedAgent.name,
                                    icon: updatedAgent.icon || undefined,
                                    runtime: updatedAgent.preferredRuntime ?? candidate.runtime,
                                  }
                                : candidate
                            )
                          ),
                      });
                    }}
                    className="flex size-6 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setMembers(
                        team.members.filter((candidate) => candidate.handle !== member.handle)
                      )
                    }
                    title={t('common.remove')}
                    aria-label={t('common.remove')}
                    className="flex size-6 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-background-2 hover:text-destructive"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              }
            />
          );
        })}
        {team.members.length === 0 && (
          // The one state that stops this paradigm from running, so it says what to
          // do rather than only that nothing is here.
          <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-border/60 px-3 py-4 text-center">
            <Users className="size-5 text-foreground-passive" />
            <p className="text-xs text-foreground-muted">{t('agentTeams.noMembers')}</p>
            <p className="text-[11px] leading-relaxed text-foreground-passive">
              {t('agentTeams.membersGuide')}
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
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
            className="h-8 min-w-0 flex-1 justify-start text-xs"
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
          size="sm"
          className="h-8 shrink-0 text-xs"
          onClick={() => showAgentModal({ onSuccess: addAgent })}
        >
          <Plus className="size-3.5" />
          {t('agentTeams.createAgent')}
        </Button>
      </div>

      {/* Why the roster is ordered the way it is — kept small and last, because it
          explains the controls above rather than being one of them. */}
      <p className="text-[11px] leading-relaxed text-foreground-passive">
        {t('agentTeams.membersHint')}
      </p>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger className="flex items-center gap-1.5 self-start rounded-md px-1 py-0.5 text-xs text-foreground-muted transition-colors hover:text-foreground">
          <Settings2 className="size-3.5 shrink-0" />
          <span>{t('agentTeams.advancedSettings')}</span>
          <ChevronDown
            className={cn('size-3 shrink-0 transition-transform', advancedOpen && 'rotate-180')}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-2.5 pt-2">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">{t('agentTeams.collaboration')}</Label>
            <Select
              modal={false}
              value={team.routing}
              onValueChange={(value) => write({ routing: value as TeamRouting })}
            >
              <SelectTrigger className="h-8 w-full text-xs">
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

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">{t('agentTeams.communicationMode')}</Label>
            <Select
              modal={false}
              value={team.communication.mode}
              onValueChange={(mode) =>
                write({
                  communication: { ...team.communication, mode: mode as TeamCommunicationMode },
                })
              }
            >
              <SelectTrigger
                className="h-8 w-full text-xs"
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
            <p className="text-[10px] leading-relaxed text-foreground-passive">
              {t(`agentTeams.communicationModes.${team.communication.mode}.description`)}
            </p>
          </div>

          {team.communication.mode === 'shared-file' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="team-paradigm-shared-file" className="text-xs">
                {t('agentTeams.sharedFilePath')}
              </Label>
              <Input
                id="team-paradigm-shared-file"
                defaultValue={team.communication.sharedFilePath}
                onBlur={(event) =>
                  write({
                    communication: {
                      ...team.communication,
                      sharedFilePath: event.target.value,
                    },
                  })
                }
                className="h-8 font-mono text-xs"
              />
            </div>
          )}

          {team.communication.mode === 'github' && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="team-paradigm-github-repository" className="text-xs">
                  {t('agentTeams.githubRepository')}
                </Label>
                <Input
                  id="team-paradigm-github-repository"
                  defaultValue={team.communication.githubRepository}
                  onBlur={(event) =>
                    write({
                      communication: {
                        ...team.communication,
                        githubRepository: event.target.value,
                      },
                    })
                  }
                  placeholder={t('agentTeams.githubRepositoryPlaceholder')}
                  className="h-8 font-mono text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <IssueNumberField
                  id="team-paradigm-github-issue"
                  label={t('agentTeams.githubIssue')}
                  value={team.communication.githubIssueNumber}
                  onCommit={(githubIssueNumber) =>
                    write({ communication: { ...team.communication, githubIssueNumber } })
                  }
                />
                <IssueNumberField
                  id="team-paradigm-github-pr"
                  label={t('agentTeams.githubPullRequest')}
                  value={team.communication.githubPullRequestNumber}
                  onCommit={(githubPullRequestNumber) =>
                    write({ communication: { ...team.communication, githubPullRequestNumber } })
                  }
                />
              </div>
              <p className="text-[10px] leading-relaxed text-foreground-passive">
                {t('agentTeams.githubPollingHint')}
              </p>
            </>
          )}

          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="team-paradigm-routing-limit"
              className="text-xs"
              title={t('agentTeams.routingLimitHint')}
            >
              {t('agentTeams.routingLimit')}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="team-paradigm-routing-limit"
                type="number"
                min={1}
                step={1}
                disabled={team.routingHopLimit === null}
                defaultValue={team.routingHopLimit ?? ''}
                key={`routing-limit-${team.routingHopLimit}`}
                onBlur={(event) =>
                  write({ routingHopLimit: normalizeRoutingHopLimit(Number(event.target.value)) })
                }
                className="h-8 min-w-0 flex-1 text-xs"
              />
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-foreground-muted">
                <Checkbox
                  checked={team.routingHopLimit === null}
                  onCheckedChange={(checked) =>
                    write({ routingHopLimit: checked ? null : DEFAULT_ROUTING_HOP_LIMIT })
                  }
                />
                {t('agentTeams.unlimited')}
              </label>
            </div>
          </div>

          <label
            className="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 px-2.5 py-1.5"
            title={t('agentTeams.syncToRoomHint')}
          >
            <Checkbox
              checked={team.communication.syncToRoom}
              onCheckedChange={(checked) =>
                write({
                  communication: { ...team.communication, syncToRoom: checked === true },
                })
              }
            />
            <span className="text-xs font-medium">{t('agentTeams.syncToRoom')}</span>
          </label>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function IssueNumberField({
  id,
  label,
  value,
  onCommit,
}: {
  id: string;
  label: string;
  value: number | null;
  onCommit: (value: number | null) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        min={1}
        step={1}
        defaultValue={value ?? ''}
        onBlur={(event) => {
          const next = Number(event.target.value);
          onCommit(Number.isInteger(next) && next > 0 ? next : null);
        }}
        placeholder="#"
        className="h-8 text-xs"
      />
    </div>
  );
}
