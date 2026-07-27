import { ChevronRight, Copy, Folder, Loader2, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import React, { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Prompt, PromptCreateInput } from '@shared/prompt-library';
import PromptsSettingsCard from '@renderer/features/settings/components/PromptsSettingsCard';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';
import { LeakedPromptsReference } from './leaked-prompts-reference';
import { getNamedPromptGroups, groupPrompts, UNGROUPED_PROMPT_GROUP } from './prompt-groups';
import { useCreatePrompt, useDeletePrompt, usePrompts, useUpdatePrompt } from './use-prompts';

type PromptDraft = {
  title: string;
  description: string;
  content: string;
  groupName: string;
};

const EMPTY_DRAFT: PromptDraft = { title: '', description: '', content: '', groupName: '' };

function draftFromEntry(entry: Prompt): PromptDraft {
  return {
    title: entry.title,
    description: entry.description,
    content: entry.content,
    groupName: entry.groupName,
  };
}

function draftToInput(draft: PromptDraft): PromptCreateInput {
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    content: draft.content.trim(),
    groupName: draft.groupName.trim(),
  };
}

export function PromptLibraryPanel({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const showConfirm = useShowModal('confirmActionModal');
  const { data, isLoading } = usePrompts();
  const createPrompt = useCreatePrompt();
  const updatePrompt = useUpdatePrompt();
  const deletePrompt = useDeletePrompt();
  const groupOptionsId = useId();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PromptDraft>(EMPTY_DRAFT);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());

  const items = useMemo(() => data ?? [], [data]);
  const groups = useMemo(() => groupPrompts(items), [items]);
  const namedGroups = useMemo(() => getNamedPromptGroups(items), [items]);
  const editorOpen = editingId !== null;
  const canSave = draft.title.trim().length > 0 && draft.content.trim().length > 0;

  const openCreate = () => {
    setEditingId('new');
    setDraft(EMPTY_DRAFT);
  };

  const openEdit = (entry: Prompt) => {
    setEditingId(entry.id);
    setDraft(draftFromEntry(entry));
  };

  const closeEditor = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  };

  const handleSave = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    const input = draftToInput(draft);
    const onError = (error: unknown) =>
      toast({
        title: t('promptLibrary.saveFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    if (editingId && editingId !== 'new') {
      updatePrompt.mutate({ id: editingId, patch: input }, { onError });
    } else {
      createPrompt.mutate(input, { onError });
    }
    closeEditor();
  };

  const handleDelete = (entry: Prompt) => {
    showConfirm({
      title: t('promptLibrary.delete.title'),
      description: t('promptLibrary.delete.description', { name: entry.title }),
      confirmLabel: t('promptLibrary.delete.confirmLabel'),
      onSuccess: () => {
        deletePrompt.mutate(entry.id);
        if (editingId === entry.id) closeEditor();
      },
    });
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGroup = (groupName: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupName)) next.delete(groupName);
      else next.add(groupName);
      return next;
    });
  };

  const handleCopy = (entry: Prompt) => {
    void navigator.clipboard.writeText(entry.content).then(
      () => toast({ title: t('promptLibrary.copied') }),
      () => undefined
    );
  };

  if (isLoading) {
    return (
      <div
        className={cn(
          'flex items-center justify-center bg-background text-foreground',
          embedded ? 'h-48' : 'h-full'
        )}
      >
        <Loader2 className="size-6 animate-spin text-foreground-muted" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        '@container flex bg-background text-foreground',
        !embedded && 'h-full min-h-0 overflow-y-auto'
      )}
    >
      <div
        className={cn('flex w-full flex-col', !embedded && 'mx-auto max-w-[1060px] px-10 py-12')}
      >
        {!embedded && (
          <h1 className="text-4xl font-normal tracking-normal">{t('promptLibrary.title')}</h1>
        )}

        {/* Atomic principles: always-on, injected into every session. Reuses the
            settings card so both surfaces edit the same data. */}
        <section className={cn(embedded ? 'mt-6' : 'mt-12')}>
          <h2 className="text-sm font-medium text-foreground">
            {t('promptLibrary.principles.title')}
          </h2>
          <div className="mt-3">
            <PromptsSettingsCard />
          </div>
        </section>

        {/* Reusable templates: opt-in prompts the user picks when composing a task. */}
        <section className={cn(embedded ? 'mt-8' : 'mt-12')}>
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-sm font-medium text-foreground">
              {t('promptLibrary.templates.title')}
            </h2>
            <Button type="button" variant="outline" size="sm" onClick={openCreate}>
              <Plus className="size-4" />
              {t('promptLibrary.new')}
            </Button>
          </div>

          {editorOpen && (
            <form
              onSubmit={handleSave}
              className="mt-10 grid gap-4 rounded-lg border border-border bg-background-secondary p-4"
            >
              <label className="grid gap-1.5">
                <span className="text-xs text-foreground-muted">
                  {t('promptLibrary.form.title')}
                </span>
                <Input
                  value={draft.title}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, title: event.target.value }))
                  }
                  placeholder={t('promptLibrary.form.titlePlaceholder')}
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs text-foreground-muted">
                  {t('promptLibrary.form.description')}
                </span>
                <Input
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, description: event.target.value }))
                  }
                  placeholder={t('promptLibrary.form.descriptionPlaceholder')}
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs text-foreground-muted">
                  {t('promptLibrary.form.group')}
                </span>
                <Input
                  list={groupOptionsId}
                  value={draft.groupName}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, groupName: event.target.value }))
                  }
                  placeholder={t('promptLibrary.form.groupPlaceholder')}
                />
                <datalist id={groupOptionsId}>
                  {namedGroups.map((groupName) => (
                    <option key={groupName} value={groupName} />
                  ))}
                </datalist>
                <span className="text-xs text-foreground-passive">
                  {t('promptLibrary.form.groupHint')}
                </span>
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs text-foreground-muted">
                  {t('promptLibrary.form.content')}
                </span>
                <Textarea
                  value={draft.content}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, content: event.target.value }))
                  }
                  placeholder={t('promptLibrary.form.contentPlaceholder')}
                  className="min-h-40 resize-y font-mono"
                />
              </label>
              <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={closeEditor}>
                  <X className="size-4" />
                  {t('common.cancel')}
                </Button>
                <Button type="submit" size="sm" disabled={!canSave}>
                  <Save className="size-4" />
                  {editingId !== 'new' ? t('common.save') : t('common.create')}
                </Button>
              </div>
            </form>
          )}

          <div className="mt-6">
            {items.length === 0 ? (
              <p className="text-sm text-foreground-muted">{t('promptLibrary.empty')}</p>
            ) : (
              <ul className="grid gap-3">
                {groups.map((group) => {
                  const groupIsOpen = !collapsedGroups.has(group.name);
                  const groupLabel =
                    group.name === UNGROUPED_PROMPT_GROUP
                      ? t('promptLibrary.groups.ungrouped')
                      : group.name;
                  return (
                    <li
                      key={group.name || 'ungrouped'}
                      className="overflow-hidden rounded-lg border border-border bg-background-secondary"
                    >
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.name)}
                        aria-expanded={groupIsOpen}
                        className="flex w-full min-w-0 items-center gap-2 px-3 py-2.5 text-left outline-none transition-colors hover:bg-background-1 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border"
                      >
                        <ChevronRight
                          className={cn(
                            'size-4 shrink-0 text-foreground-muted transition-transform',
                            groupIsOpen && 'rotate-90'
                          )}
                        />
                        <Folder className="size-4 shrink-0 text-foreground-muted" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                          {groupLabel}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-foreground-passive">
                          {t('promptLibrary.groups.count', { count: group.prompts.length })}
                        </span>
                      </button>

                      {groupIsOpen && (
                        <ul className="border-t border-border">
                          {group.prompts.map((entry) => {
                            const isOpen = expandedIds.has(entry.id);
                            return (
                              <li
                                key={entry.id}
                                className="group/prompt border-t border-border first:border-t-0"
                              >
                                <div className="flex items-center gap-2 px-3 py-2.5 pl-8">
                                  <button
                                    type="button"
                                    onClick={() => toggleExpanded(entry.id)}
                                    aria-expanded={isOpen}
                                    className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:rounded-sm focus-visible:ring-1 focus-visible:ring-border"
                                  >
                                    <ChevronRight
                                      className={cn(
                                        'size-4 shrink-0 text-foreground-muted transition-transform',
                                        isOpen && 'rotate-90'
                                      )}
                                    />
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-sm font-medium text-foreground">
                                        {entry.title}
                                      </span>
                                      {entry.description && (
                                        <span className="mt-0.5 block truncate text-xs text-foreground-muted">
                                          {entry.description}
                                        </span>
                                      )}
                                    </span>
                                  </button>
                                  <div className="flex shrink-0 items-center gap-1 opacity-70 transition-opacity group-hover/prompt:opacity-100 group-focus-within/prompt:opacity-100">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-sm"
                                      aria-label={t('promptLibrary.copy')}
                                      onClick={() => handleCopy(entry)}
                                    >
                                      <Copy className="size-4" />
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-sm"
                                      aria-label={t('common.edit')}
                                      onClick={() => openEdit(entry)}
                                    >
                                      <Pencil className="size-4" />
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-sm"
                                      aria-label={t('common.delete')}
                                      onClick={() => handleDelete(entry)}
                                    >
                                      <Trash2 className="size-4" />
                                    </Button>
                                  </div>
                                </div>
                                {isOpen && (
                                  <div className="border-t border-border px-3 py-2.5 pl-14">
                                    <pre className="min-w-0 whitespace-pre-wrap break-words font-mono text-xs text-foreground-passive">
                                      {entry.content}
                                    </pre>
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* Reference: read-only gallery of community-leaked system prompts. */}
        <LeakedPromptsReference />
      </div>
    </div>
  );
}
