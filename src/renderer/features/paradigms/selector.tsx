import { Check, ChevronDown, Pencil } from 'lucide-react';
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
  paradigmEntryOwnName,
  type ParadigmEntry,
} from './entries';
import { ParadigmEntryCard } from './entry-card';
import { ParadigmIcon, ParadigmMark } from './icons';
import { paradigmSeatAgentId } from './seats';
import { useParadigms } from './use-paradigms';

export interface ParadigmSelectorProps {
  kindId: ParadigmKindId;
  /** Remembered paradigm instance for `kindId`; empty selects its built-in. */
  paradigmId: string;
  teams: AgentTeam[];
  agents: Agent[];
  /**
   * Seat assignments from the composer draft, where they lived before they
   * belonged to an instance. Read-only: every write lands in the instance's params.
   */
  draftAgents: Record<string, string[]>;
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
    // Seeded with the instance's own name, not the name it displays: that can fall
    // back to the category or to the Agent in its seat, and storing either would
    // freeze a borrowed label as this instance's own.
    setEditDraft({ label: paradigmEntryOwnName(entry), icon: entry.avatar ?? '' });
  };

  /**
   * Writes the draft without leaving edit mode.
   *
   * Edits persist as they are made rather than on the way out: the avatar picker is
   * a dialog of its own, and committing on blur tore this row down the instant it
   * opened — taking the picker with it. Leaving edit mode is now only ever the
   * user's own Enter or Escape, and nothing is riding on it.
   */
  const persistEditing = (id: string, draft = editDraft) => {
    const entry = entries.find((candidate) => candidate.id === id);
    // Nothing changed, nothing to write. Otherwise merely opening a shipped
    // paradigm's editor and clicking away would store its displayed name as its
    // own — freezing a localized label, or an Agent's name, as the instance's.
    if (
      !entry ||
      (draft.label === paradigmEntryOwnName(entry) && draft.icon === (entry.avatar ?? ''))
    )
      return;
    void setPresentation(id, draft.label, draft.icon);
    // Same footing as a seat change: the write already happened, and what the
    // button confirms is that the chooser is settled. Leaving it disabled after an
    // edit reads as the edit not having registered.
    setConfigurationDirty(true);
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
            className="flex w-[16.5rem] shrink-0 flex-col gap-1.5 overflow-y-auto bg-background-2 p-2"
          >
            {entries.map((entry) => {
              const label = labelOf(entry);
              return (
                <ParadigmEntryCard
                  key={entry.id}
                  entry={entry}
                  category={label.category}
                  name={label.name}
                  // Highlights the entry the right pane is actually showing, not
                  // the raw pending id: that id can be unset or point at an
                  // instance that is gone, and then no card looked chosen while
                  // the pane beside it was configuring one.
                  active={entry.id === pending?.id}
                  onSelect={() => setPendingId(entry.id)}
                  onDuplicate={() => void handleDuplicate(entry.id)}
                  onEdit={() => startEditing(entry)}
                  onRemove={() => void handleRemove(entry.id)}
                />
              );
            })}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
            {pending && pendingLabel && (
              // One header, two states. Editing swaps the name for a field and the
              // avatar for a picker in place, at the same footprint: an edit box of
              // its own shifted everything under it and made renaming look like a
              // different screen.
              <div className="flex items-center gap-2.5">
                {editingId === pending.id ? (
                  <AvatarInput
                    id="paradigm-avatar"
                    name={editDraft.label || pendingLabel.category}
                    value={editDraft.icon}
                    onChange={(icon) => {
                      const next = { ...editDraft, icon };
                      setEditDraft(next);
                      // The picker closes on select, so there is no blur to ride and
                      // no reason to make the user confirm a choice they just made.
                      persistEditing(pending.id, next);
                    }}
                    inputLabel={t('home.paradigmAvatar')}
                    placeholder={t('common.avatarPlaceholder')}
                    uploadTitle={t('home.paradigmAvatar')}
                    clearTitle={t('common.clearAvatar')}
                    onFileError={showAvatarFileError}
                    appearance="profile"
                    previewClassName="size-9 rounded-lg text-sm"
                  />
                ) : (
                  <ParadigmMark
                    iconId={pending.iconId}
                    avatar={pending.avatar}
                    name={pendingLabel.name ?? pendingLabel.category}
                    active
                  />
                )}
                {editingId === pending.id ? (
                  <Input
                    autoFocus
                    value={editDraft.label}
                    aria-label={t('home.paradigmName')}
                    onChange={(event) =>
                      setEditDraft((prev) => ({ ...prev, label: event.target.value }))
                    }
                    onBlur={() => persistEditing(pending.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        persistEditing(pending.id);
                        setEditingId(null);
                      }
                      if (event.key === 'Escape') setEditingId(null);
                    }}
                    placeholder={t('home.paradigmNamePlaceholder')}
                    className="h-8 min-w-0 flex-1 text-sm"
                  />
                ) : (
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                        {pendingLabel.name ?? pendingLabel.category}
                      </span>
                      {pending.alpha && (
                        <Badge
                          variant="secondary"
                          className="shrink-0 px-1 py-0 text-[9px] font-normal uppercase tracking-wide"
                        >
                          {t('home.modeAlphaBadge')}
                        </Badge>
                      )}
                    </div>
                    {pendingLabel.name && (
                      <span className="min-w-0 truncate text-[11px] leading-tight text-foreground-muted">
                        {pendingLabel.category}
                      </span>
                    )}
                  </div>
                )}
                {/* Renaming is also in the card's menu, but this is the pane the
                    edit happens on, so it gets the affordance too. Nothing is
                    riding on leaving edit mode — every edit is already written —
                    so the same button just puts the header back. */}
                <button
                  type="button"
                  aria-label={
                    editingId === pending.id ? t('common.confirm') : t('home.paradigmEdit')
                  }
                  title={editingId === pending.id ? t('common.confirm') : t('home.paradigmEdit')}
                  onClick={() => {
                    if (editingId !== pending.id) {
                      startEditing(pending);
                      return;
                    }
                    persistEditing(pending.id);
                    setEditingId(null);
                  }}
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground"
                >
                  {editingId === pending.id ? (
                    <Check className="size-3.5" />
                  ) : (
                    <Pencil className="size-3.5" />
                  )}
                </button>
              </div>
            )}
            {pending && (
              <>
                {/* The kind's own description, not the instance's: it says what
                    will happen, which is the same whatever this one is called. */}
                <p className="text-xs leading-relaxed text-foreground-muted">
                  {t(pending.descKey)}
                </p>
                <ParadigmConfigurationPanel
                  entry={pending}
                  teams={teams}
                  agents={agents}
                  slotAgentId={seatAgentId(pending)}
                  onSlotAgentChange={(slotKey, agentId) =>
                    void setSeatAgent(pending.id, slotKey, agentId)
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
