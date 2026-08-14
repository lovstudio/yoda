import { Check, ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentTeam } from '@shared/agent-team';
import type { Agent } from '@shared/agents';
import type { ParadigmKindId } from '@shared/paradigms/contract';
import { AvatarValue } from '@renderer/lib/components/avatar-value';
import { Badge } from '@renderer/lib/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@renderer/lib/ui/dialog';
import { cn } from '@renderer/utils/utils';
import { ParadigmConfigurationPanel } from './configuration-panel';
import {
  paradigmEntries,
  paradigmEntryGroups,
  paradigmEntryId,
  type ParadigmEntry,
} from './entries';
import { ParadigmIcon } from './icons';

export interface ParadigmSelectorProps {
  kindId: ParadigmKindId;
  /** Resolved runtime · model (or team name) shown beside the paradigm name. */
  summary?: string | null;
  teams: AgentTeam[];
  selectedTeamId: string;
  agents: Agent[];
  slotAgentId: (slotKey: string) => string | null;
  onSlotAgentChange: (slotKey: string, agentId: string) => void;
  onChange: (kindId: ParadigmKindId) => void;
  onSelectTeam: (teamId: string) => void;
}

/**
 * The development paradigm chooser: every paradigm instance on the left, the
 * selected one's configuration on the right.
 *
 * Entries and configuration both come from the paradigm registry, so this
 * component has no per-paradigm branch — adding a paradigm adds an entry here for
 * free.
 */
export function ParadigmSelector({
  kindId,
  summary,
  teams,
  selectedTeamId,
  agents,
  slotAgentId,
  onSlotAgentChange,
  onChange,
  onSelectTeam,
}: ParadigmSelectorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const entries = useMemo(() => paradigmEntries(teams), [teams]);
  const groups = useMemo(() => paradigmEntryGroups(entries), [entries]);
  const currentId = paradigmEntryId(entries, kindId, selectedTeamId);
  // Switching paradigm reshapes the whole run, so we stage the choice locally and
  // only commit on explicit confirmation rather than applying on each click. We
  // stage by entry id because one kind spans many entries. Agent profile edits
  // persist independently, but still require confirmation before the chooser can
  // be treated as settled.
  const [pendingId, setPendingId] = useState<string>(currentId);
  const [configurationDirty, setConfigurationDirty] = useState(false);

  const labelOf = (entry: ParadigmEntry) =>
    entry.label ?? (entry.labelKey ? t(entry.labelKey) : '');
  const current = entries.find((entry) => entry.id === currentId) ?? entries[0];
  const pending = entries.find((entry) => entry.id === pendingId) ?? current;
  const dirty = configurationDirty || pending.id !== current.id;
  const isNonStandardMode = current.kindId !== 'single';

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setPendingId(currentId);
      setConfigurationDirty(false);
    }
    setOpen(next);
  };

  const handleConfirm = () => {
    if (pending.teamId) onSelectTeam(pending.teamId);
    if (pending.kindId !== kindId) onChange(pending.kindId);
    setConfigurationDirty(false);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <button
            type="button"
            aria-label={t('home.modeAria')}
            className={cn(
              'flex h-7 min-w-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors',
              isNonStandardMode
                ? 'border-sky-500/25 bg-sky-500/10 text-sky-700 shadow-sm ring-1 ring-sky-500/15 hover:bg-sky-500/15 ydark:text-sky-300'
                : 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15'
            )}
          >
            {current.avatar !== undefined ? (
              <AvatarValue
                name={labelOf(current)}
                value={current.avatar}
                className="size-3.5 rounded-sm text-[10px]"
              />
            ) : (
              <ParadigmIcon iconId={current.iconId} className="size-3.5 shrink-0" />
            )}
            <span className="shrink-0">{labelOf(current)}</span>
            {summary ? (
              <>
                <span
                  className={cn(
                    isNonStandardMode ? 'text-sky-600/45 ydark:text-sky-300/45' : 'text-primary/40'
                  )}
                >
                  ·
                </span>
                <span
                  className={cn(
                    'min-w-0 max-w-[14rem] truncate font-normal',
                    isNonStandardMode ? 'text-sky-700/80 ydark:text-sky-300/80' : 'text-primary/80'
                  )}
                >
                  {summary}
                </span>
              </>
            ) : null}
            <ChevronDown
              className={cn(
                'size-3 shrink-0',
                isNonStandardMode ? 'text-sky-700/70 ydark:text-sky-300/70' : 'text-primary/70'
              )}
            />
          </button>
        }
      />
      <DialogContent className="flex h-[min(70dvh,40rem)] w-[min(44rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] flex-col gap-0 p-0 sm:max-w-[44rem]">
        <DialogHeader showCloseButton className="min-w-0 px-4 py-3">
          <DialogTitle className="truncate text-sm font-semibold text-foreground">
            {t('home.developmentParadigm')}
          </DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 divide-x divide-border/60 border-t border-border/60">
          <div
            role="tablist"
            aria-label={t('home.modeAria')}
            aria-orientation="vertical"
            className="flex w-44 shrink-0 flex-col gap-1 overflow-y-auto bg-background-1/50 p-2"
          >
            {groups.map((group, groupIndex) => (
              <div
                key={group.labelKey}
                className={cn(
                  'flex flex-col gap-0.5',
                  groupIndex > 0 && 'mt-1 border-t border-border/60 pt-2'
                )}
              >
                <span className="px-2.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted/70">
                  {t(group.labelKey)}
                </span>
                {group.entries.map((entry) => {
                  const active = entry.id === pendingId;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      title={t(entry.descKey)}
                      onClick={() => setPendingId(entry.id)}
                      className={cn(
                        'flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                        active
                          ? 'bg-primary/10 font-medium text-primary'
                          : 'text-foreground-muted hover:bg-background-2 hover:text-foreground'
                      )}
                    >
                      {entry.avatar !== undefined ? (
                        <AvatarValue
                          name={labelOf(entry)}
                          value={entry.avatar}
                          className="size-4 rounded-sm text-[10px]"
                        />
                      ) : (
                        <ParadigmIcon
                          iconId={entry.iconId}
                          className={cn(
                            'size-4 shrink-0',
                            active ? 'text-primary' : 'text-foreground-muted'
                          )}
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate">{labelOf(entry)}</span>
                      {entry.alpha && (
                        <Badge variant="secondary" className="shrink-0 px-1 py-0 text-[9px]">
                          {t('home.modeAlphaBadge')}
                        </Badge>
                      )}
                      {active && <Check className="size-3.5 shrink-0 text-primary" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
            <div className="flex items-center gap-2">
              {pending.avatar !== undefined ? (
                <AvatarValue
                  name={labelOf(pending)}
                  value={pending.avatar}
                  className="size-4 rounded-sm text-[10px]"
                />
              ) : (
                <ParadigmIcon iconId={pending.iconId} className="size-4 shrink-0 text-primary" />
              )}
              <span className="text-sm font-semibold text-foreground">{labelOf(pending)}</span>
              {pending.alpha && (
                <Badge variant="secondary" className="px-1 py-0 text-[9px]">
                  {t('home.modeAlphaBadge')}
                </Badge>
              )}
            </div>
            <p className="text-xs text-foreground-muted">{t(pending.descKey)}</p>
            <ParadigmConfigurationPanel
              entry={pending}
              teams={teams}
              agents={agents}
              slotAgentId={slotAgentId}
              onSlotAgentChange={onSlotAgentChange}
              onConfigurationChange={() => setConfigurationDirty(true)}
            />
          </div>
        </div>
        <DialogFooter className="px-3 py-2.5">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex h-8 items-center justify-center rounded-md border border-border bg-background-1 px-3 text-xs font-medium text-foreground transition-colors hover:bg-background-2"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!dirty}
            className="flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          >
            {t('common.confirm')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
