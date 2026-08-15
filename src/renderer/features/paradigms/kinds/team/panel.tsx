import { ChevronDown, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentTeam, TeamRouting } from '@shared/agent-team';
import { paradigmToTeam, teamToParadigmParams } from '@shared/paradigms/team-adapter';
import { TEAM_COMMUNICATION_MODES, type TeamCommunicationMode } from '@shared/team-communication';
import { DEFAULT_ROUTING_HOP_LIMIT, normalizeRoutingHopLimit } from '@shared/team-routing-limit';
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

const ROUTING_LABEL_KEYS: Record<TeamRouting, string> = {
  'review-loop': 'agentTeams.routing.reviewLoop',
  'fan-out': 'agentTeams.routing.fanOut',
  sequential: 'agentTeams.routing.sequential',
  freeform: 'agentTeams.routing.freeform',
};

/**
 * How a multi-agent paradigm's members hand work to each other.
 *
 * Who is on the roster is not here: that is the roster editor above, shared with
 * every other paradigm, because a set of Agents is what any paradigm is. What is
 * left is the wiring only a team has — routing, where the work is recorded, how far
 * a prompt may be relayed — and it stays collapsed, because a team runs without any
 * of it being touched.
 */
export function TeamParadigmPanel({ entry, onConfigurationChange }: ParadigmPanelProps) {
  const { t } = useTranslation();
  const { paradigms, setParams } = useParadigms();
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

  return (
    <div className="flex flex-col gap-2">
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
