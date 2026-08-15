import { Check, ChevronDown, Copy, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentTeamMember } from '@shared/agent-team';
import type { Agent } from '@shared/agents';
import type { ParadigmKindId } from '@shared/paradigms/contract';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
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
import { paradigmRoster, rosterAgent, rosterDraft } from './roster';
import { useParadigms } from './use-paradigms';

export interface ParadigmSelectorProps {
  kindId: ParadigmKindId;
  /** Remembered paradigm instance for `kindId`; empty selects its built-in. */
  paradigmId: string;
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
  agents,
  draftAgents,
  onChange,
}: ParadigmSelectorProps) {
  const { t } = useTranslation();
  const { paradigms, create, update, setPresentation, remove, duplicate } = useParadigms();
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

  // A paradigm *is* its roster, so the list reads it per instance: a duplicated
  // paradigm's Agents are its own, which is what makes the copy worth having.
  // Bound per entry so a row and its configuration panel cannot disagree about
  // who is on the list.
  const rosterOf = (entry: ParadigmEntry) =>
    paradigmRoster({
      paradigm: paradigms.find((paradigm) => paradigm.id === entry.id),
      agents,
      draftAgents,
    });
  /**
   * The one line under a row's name: who it runs with.
   *
   * One Agent is named outright — for a kind's own built-in that name is the whole
   * point of the row. Several are counted, because three names do not fit and the
   * count is what the user is choosing between anyway.
   */
  const rosterSummary = (entry: ParadigmEntry): string => {
    const members = rosterOf(entry);
    if (members.length === 0) return t(entry.descKey);
    const sole = members[0];
    if (members.length === 1 && sole) return rosterAgent(sole, agents)?.name ?? sole.displayName;
    return t('home.paradigmRosterCount', { count: members.length });
  };
  const labelOf = (entry: ParadigmEntry) => paradigmEntryLabel(entry, t);

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

  /**
   * A paradigm from scratch: one Agent, no parameters, named for renaming.
   *
   * It starts as a `single` because that is what one Agent is, not because the user
   * chose a category — adding a second Agent in the panel migrates it. There is no
   * empty state to fill first: the seat falls back to the general Agent, so the new
   * row is launchable the moment it exists.
   */
  const handleCreate = async () => {
    const created = await create({
      kindId: 'single',
      label: t('home.paradigmNewName'),
      icon: '',
      params: { agents: {} },
    });
    setPendingId(created.id);
    setEditingId(created.id);
    setEditDraft({ label: created.label, icon: created.icon });
  };

  /**
   * The only write behind the roster editor, and the only place a paradigm changes
   * kind.
   *
   * Going from one Agent to several is a different storage shape, which `rosterDraft`
   * works out. A built-in cannot make that crossing — its id is a shipped constant
   * other params point at — so it is duplicated first and the copy migrates, which
   * is also the honest outcome: the user was editing a default and now owns one.
   */
  const handleRosterChange = async (entry: ParadigmEntry, members: AgentTeamMember[]) => {
    const paradigm = paradigms.find((candidate) => candidate.id === entry.id);
    if (!paradigm) return;
    const draft = rosterDraft({ paradigm, members, agents });
    if (draft.kindId !== paradigm.kindId && paradigm.builtin) {
      const label = labelOf(entry);
      const copy = await duplicate(paradigm.id);
      setPendingId(copy.id);
      // The main process names a copy `"<label> copy"` — it cannot resolve i18n
      // keys — so this write, which has to happen anyway, corrects it.
      await update(
        copy.id,
        rosterDraft({
          paradigm: copy,
          members,
          agents,
          label: t('home.paradigmCopyName', { name: label.name ?? label.category }),
        })
      );
      toast({ title: t('home.paradigmForkedForRoster') });
    } else {
      await update(paradigm.id, draft);
    }
    setConfigurationDirty(true);
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
          <div className="flex w-[16.5rem] shrink-0 flex-col bg-background-2">
            <div
              role="tablist"
              aria-label={t('home.modeAria')}
              aria-orientation="vertical"
              className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2"
            >
              {entries.map((entry) => {
                const label = labelOf(entry);
                return (
                  <ParadigmEntryCard
                    key={entry.id}
                    entry={entry}
                    title={label.name ?? label.category}
                    subtitle={rosterSummary(entry)}
                    // Highlights the entry the right pane is actually showing, not
                    // the raw pending id: that id can be unset or point at an
                    // instance that is gone, and then no card looked chosen while
                    // the pane beside it was configuring one.
                    active={entry.id === pending?.id}
                    onSelect={() => setPendingId(entry.id)}
                  />
                );
              })}
            </div>
            {/* Pinned to the bottom rather than sitting after the last card: with
                nine rows it scrolls out of sight, and creating is the one action in
                this column that is not about the rows already in it. */}
            <div className="shrink-0 border-t border-border/60 p-2">
              <button
                type="button"
                onClick={() => void handleCreate()}
                className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-xs font-medium text-foreground-muted transition-colors hover:border-border-1 hover:bg-background-1 hover:text-foreground"
              >
                <Plus className="size-3.5" />
                {t('home.paradigmNew')}
              </button>
            </div>
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
                {/* Renaming is one job, so it gets its own button rather than
                    hiding in the menu beside it. Nothing is riding on leaving edit
                    mode — every edit is already written — so the same button just
                    puts the header back. */}
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
                {/* Everything else this paradigm can have done to it. Kept off the
                    list rows: a row is a name to pick, and nine rows each carrying
                    their own menu made the list read as a toolbar. */}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={t('common.more')}
                    title={t('common.more')}
                    className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onClick={() => void handleDuplicate(pending.id)}>
                      <Copy className="size-3.5" />
                      {t('home.paradigmDuplicate')}
                    </DropdownMenuItem>
                    {/* A shipped paradigm stays: the app references it by id, and
                        clearing its name and icon already restores what it shipped
                        with. */}
                    {!pending.builtin && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => void handleRemove(pending.id)}
                        >
                          <Trash2 className="size-3.5" />
                          {t('home.paradigmRemove')}
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
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
                  agents={agents}
                  roster={rosterOf(pending)}
                  onRosterChange={(members) => void handleRosterChange(pending, members)}
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
