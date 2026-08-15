import { ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentTeam } from '@shared/agent-team';
import type { Agent } from '@shared/agents';
import type { ParadigmKindId } from '@shared/paradigms/contract';
import { paradigmKind } from '@shared/paradigms/kinds';
import { AvatarInput, type AvatarFileError } from '@renderer/lib/components/avatar-input';
import { AvatarValue } from '@renderer/lib/components/avatar-value';
import { toast } from '@renderer/lib/hooks/use-toast';
import { Badge } from '@renderer/lib/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@renderer/lib/ui/dialog';
import { Input } from '@renderer/lib/ui/input';
import { cn } from '@renderer/utils/utils';
import { ParadigmConfigurationPanel } from './configuration-panel';
import {
  paradigmEntries,
  paradigmEntryId,
  paradigmEntryLabel,
  type ParadigmEntry,
} from './entries';
import { ParadigmEntryRow } from './entry-row';
import { ParadigmIcon } from './icons';
import { paradigmSeatAgentId } from './seats';
import { useParadigms } from './use-paradigms';

export interface ParadigmSelectorProps {
  kindId: ParadigmKindId;
  /** Remembered paradigm instance for `kindId`; empty selects its built-in. */
  paradigmId: string;
  teams: AgentTeam[];
  agents: Agent[];
  /** Composer-draft seat assignments, keyed by slot storage key. */
  draftAgents: Record<string, string[]>;
  /** Seat write for a built-in instance, whose seats live in the draft. */
  onDraftSlotAgentChange: (slotKey: string, agentId: string) => void;
  onChange: (kindId: ParadigmKindId, paradigmId: string) => void;
}

/**
 * The development paradigm chooser: every paradigm on the left, the selected one's
 * configuration on the right.
 *
 * The list is flat and every row is one paradigm — one way of developing —
 * whatever kind implements it. Rows come from the `paradigms` table, so each is
 * renameable, re-iconable, and duplicable, and adding a kind adds a row here for
 * free.
 *
 * Each row reads as "category · name · parameters": what way of working it is,
 * which one of those, and what it will actually run with.
 */
export function ParadigmSelector({
  kindId,
  paradigmId,
  teams,
  agents,
  draftAgents,
  onDraftSlotAgentChange,
  onChange,
}: ParadigmSelectorProps) {
  const { t } = useTranslation();
  const { paradigms, setPresentation, setSeatAgent, remove, duplicate } = useParadigms();
  const [open, setOpen] = useState(false);
  const entries = useMemo(() => paradigmEntries(paradigms), [paradigms]);
  const currentId = paradigmEntryId(entries, kindId, paradigmId);
  // Switching paradigm reshapes the whole run, so we stage the choice locally and
  // only commit on explicit confirmation rather than applying on each click. Agent
  // profile edits persist independently, but still require confirmation before the
  // chooser can be treated as settled.
  const [pendingId, setPendingId] = useState<string | undefined>(currentId);
  const [configurationDirty, setConfigurationDirty] = useState(false);
  // Renaming happens in place on the detail pane rather than in a nested dialog,
  // which would put a modal on top of a modal to edit two fields.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ label: '', icon: '' });

  const current = entries.find((entry) => entry.id === currentId) ?? entries[0];
  const pending = entries.find((entry) => entry.id === pendingId) ?? current;
  const dirty = configurationDirty || (pending !== undefined && pending.id !== current?.id);
  const isNonStandardMode = current !== undefined && current.kindId !== 'single';

  // Seats resolve per instance: a duplicated paradigm's Agents are its own, which
  // is what makes the copy worth having. Bound per entry so a row's name and its
  // configuration panel cannot disagree about who is assigned.
  const seatAgentId = (entry: ParadigmEntry) => (slotStorageKey: string) =>
    paradigmSeatAgentId({
      paradigm: paradigms.find((paradigm) => paradigm.id === entry.id),
      slotStorageKey,
      draftAgents,
      agents,
    });
  /**
   * What an unnamed instance goes by: the Agent in its implementer seat.
   *
   * A kind's own built-in was never named, but the Agent sitting in it was — and
   * that name is the one the user recognizes, so it stands in rather than leaving
   * the row as a bare category.
   */
  const seatAgentName = (entry: ParadigmEntry): string | null => {
    const slot = paradigmKind(entry.kindId).slots[0];
    if (!slot) return null;
    const agentId = seatAgentId(entry)(slot.storageKey);
    return agents.find((agent) => agent.id === agentId)?.name ?? null;
  };
  const labelOf = (entry: ParadigmEntry) => paradigmEntryLabel(entry, t, seatAgentName(entry));

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setPendingId(currentId);
      setConfigurationDirty(false);
      setEditingId(null);
    }
    setOpen(next);
  };

  const handleConfirm = () => {
    if (pending) onChange(pending.kindId, pending.id);
    setConfigurationDirty(false);
    setOpen(false);
  };

  const startEditing = (entry: ParadigmEntry) => {
    setPendingId(entry.id);
    setEditingId(entry.id);
    // Seeded with the instance's own name, not its category: editing sets what
    // distinguishes this one, and pre-filling the category would invite a name
    // that repeats it.
    setEditDraft({ label: entry.name ?? '', icon: entry.avatar ?? '' });
  };

  const commitEditing = async (id: string) => {
    setEditingId(null);
    await setPresentation(id, editDraft.label, editDraft.icon);
  };

  const handleDuplicate = async (id: string) => {
    const copy = await duplicate(id);
    // Land on the copy with its name open for editing: the point of duplicating is
    // to change it, and it is named after the original, so leaving it unnamed in a
    // list of near-identical rows is the one outcome nobody wants.
    setPendingId(copy.id);
    setEditingId(copy.id);
    setEditDraft({ label: copy.label, icon: copy.icon });
  };

  const handleRemove = async (id: string) => {
    // Staging falls back to the committed selection so the detail pane does not
    // keep rendering a paradigm that no longer exists.
    if (pendingId === id) setPendingId(currentId);
    if (editingId === id) setEditingId(null);
    await remove(id);
  };

  /** A user instance stores seats in its params; a built-in has only the draft. */
  const assignSeat = async (entry: ParadigmEntry, slotKey: string, agentId: string) => {
    const stored = await setSeatAgent(entry.id, slotKey, agentId);
    if (!stored) onDraftSlotAgentChange(slotKey, agentId);
  };

  const showAvatarFileError = (error: AvatarFileError) => {
    const key =
      error === 'too-large'
        ? 'common.avatarFileTooLarge'
        : error === 'unsupported'
          ? 'common.avatarUnsupported'
          : 'common.avatarReadFailed';
    toast({ title: t(key), variant: 'destructive' });
  };

  const currentLabel = current ? labelOf(current) : null;
  const pendingLabel = pending ? labelOf(pending) : null;

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
            {current?.avatar !== undefined ? (
              <AvatarValue
                name={currentLabel?.name ?? currentLabel?.category ?? ''}
                value={current.avatar}
                className="size-3.5 rounded-sm text-[10px]"
              />
            ) : (
              current && <ParadigmIcon iconId={current.iconId} className="size-3.5 shrink-0" />
            )}
            {/* Category, then which one of it — the chip answers both without
                opening the dialog. */}
            <span className="shrink-0">{currentLabel?.category ?? ''}</span>
            {currentLabel?.name ? (
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
                  {currentLabel.name}
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
            className="flex w-60 shrink-0 flex-col gap-px overflow-y-auto bg-background-1/50 p-1.5"
          >
            {entries.map((entry) => {
              const label = labelOf(entry);
              return (
                <ParadigmEntryRow
                  key={entry.id}
                  entry={entry}
                  category={label.category}
                  name={label.name}
                  active={entry.id === pendingId}
                  onSelect={() => setPendingId(entry.id)}
                  onDuplicate={() => void handleDuplicate(entry.id)}
                  onEdit={() => startEditing(entry)}
                  onRemove={() => void handleRemove(entry.id)}
                />
              );
            })}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
            {pending && editingId === pending.id ? (
              <div className="flex items-end gap-3 border border-border/60 bg-background-1/40 p-2">
                <AvatarInput
                  id="paradigm-avatar"
                  name={editDraft.label}
                  value={editDraft.icon}
                  onChange={(icon) => setEditDraft((prev) => ({ ...prev, icon }))}
                  inputLabel={t('home.paradigmAvatar')}
                  placeholder={t('common.avatarPlaceholder')}
                  uploadTitle={t('common.uploadPhoto')}
                  clearTitle={t('common.clearAvatar')}
                  onFileError={showAvatarFileError}
                  appearance="profile"
                />
                <Input
                  autoFocus
                  aria-label={t('home.paradigmName')}
                  value={editDraft.label}
                  onChange={(event) =>
                    setEditDraft((prev) => ({ ...prev, label: event.target.value }))
                  }
                  onBlur={() => void commitEditing(pending.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void commitEditing(pending.id);
                    if (event.key === 'Escape') setEditingId(null);
                  }}
                  placeholder={t('home.paradigmNamePlaceholder')}
                  className="h-8 min-w-0 flex-1 text-sm"
                />
              </div>
            ) : (
              pending &&
              pendingLabel && (
                <div className="flex items-center gap-2">
                  {pending.avatar !== undefined ? (
                    <AvatarValue
                      name={pendingLabel.name ?? pendingLabel.category}
                      value={pending.avatar}
                      className="size-4 rounded-sm text-[10px]"
                    />
                  ) : (
                    <ParadigmIcon
                      iconId={pending.iconId}
                      className="size-4 shrink-0 text-primary"
                    />
                  )}
                  <span className="text-sm font-semibold text-foreground">
                    {pendingLabel.category}
                  </span>
                  {pendingLabel.name && (
                    <span className="min-w-0 truncate text-sm text-foreground-muted">
                      {pendingLabel.name}
                    </span>
                  )}
                  {pending.alpha && (
                    <Badge variant="secondary" className="px-1 py-0 text-[9px]">
                      {t('home.modeAlphaBadge')}
                    </Badge>
                  )}
                </div>
              )
            )}
            {pending && (
              <>
                <p className="text-xs text-foreground-muted">{t(pending.descKey)}</p>
                <ParadigmConfigurationPanel
                  entry={pending}
                  teams={teams}
                  agents={agents}
                  slotAgentId={seatAgentId(pending)}
                  onSlotAgentChange={(slotKey, agentId) =>
                    void assignSeat(pending, slotKey, agentId)
                  }
                  onConfigurationChange={() => setConfigurationDirty(true)}
                />
              </>
            )}
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
