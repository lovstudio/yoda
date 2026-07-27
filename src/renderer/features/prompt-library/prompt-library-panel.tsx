import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Folder,
  GitBranch,
  Link,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import React, { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PROMPT_SOURCE_DEFAULT_REFRESH_MINUTES,
  PROMPT_SOURCE_DEFAULT_TIMEOUT_SECONDS,
  type Prompt,
  type PromptCreateInput,
  type PromptSource,
  type PromptSourceError,
} from '@shared/prompt-library';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Switch } from '@renderer/lib/ui/switch';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';
import { getNamedPromptGroups, groupPrompts, UNGROUPED_PROMPT_GROUP } from './prompt-groups';
import {
  useCreatePrompt,
  useDeletePrompt,
  usePrompts,
  useRefreshPromptSource,
  useReorderInjectedPrompts,
  useUpdatePrompt,
} from './use-prompts';

type PromptDraft = {
  title: string;
  description: string;
  content: string;
  groupName: string;
  extraInfo: string;
  injectionEnabled: boolean;
  source?: PromptSource;
};

type SourceForm =
  | { type: 'url'; url: string; refreshMinutes: string; timeoutSeconds: string }
  | {
      type: 'git';
      repositoryUrl: string;
      filePath: string;
      ref: string;
      refreshMinutes: string;
      timeoutSeconds: string;
    };

const EMPTY_DRAFT: PromptDraft = {
  title: '',
  description: '',
  content: '',
  groupName: '',
  extraInfo: '',
  injectionEnabled: false,
};

const DEFAULT_REFRESH = String(PROMPT_SOURCE_DEFAULT_REFRESH_MINUTES);
const DEFAULT_TIMEOUT = String(PROMPT_SOURCE_DEFAULT_TIMEOUT_SECONDS);

function draftFromEntry(entry: Prompt): PromptDraft {
  return {
    title: entry.title,
    description: entry.description,
    content: entry.content,
    groupName: entry.groupName,
    extraInfo: entry.extraInfo,
    injectionEnabled: entry.injectionEnabled,
    source: entry.source,
  };
}

function draftToCreateInput(draft: PromptDraft): PromptCreateInput {
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    content: draft.content.trim(),
    groupName: draft.groupName.trim(),
    extraInfo: draft.extraInfo.trim(),
    injectionEnabled: draft.injectionEnabled,
    source: draft.source,
  };
}

function parseNumber(value: string): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function sourceTarget(source: PromptSource): string {
  if (source.type === 'file') return source.path;
  if (source.type === 'url') return source.url;
  return `${source.repositoryUrl} · ${source.filePath}${source.ref ? ` @ ${source.ref}` : ''}`;
}

function isExternalUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function PromptLibraryPanel({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const showConfirm = useShowModal('confirmActionModal');
  const { data, isLoading } = usePrompts();
  const createPrompt = useCreatePrompt();
  const updatePrompt = useUpdatePrompt();
  const deletePrompt = useDeletePrompt();
  const reorderPrompts = useReorderInjectedPrompts();
  const refreshSource = useRefreshPromptSource();
  const groupOptionsId = useId();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PromptDraft>(EMPTY_DRAFT);
  const [sourceForm, setSourceForm] = useState<SourceForm | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());

  const items = useMemo(() => data ?? [], [data]);
  const groups = useMemo(() => groupPrompts(items), [items]);
  const namedGroups = useMemo(() => getNamedPromptGroups(items), [items]);
  const injectedPrompts = useMemo(
    () =>
      items
        .filter((item) => item.injectionEnabled)
        .sort((left, right) => left.injectionOrder - right.injectionOrder),
    [items]
  );
  const editorOpen = editingId !== null;
  const canSave = draft.title.trim().length > 0 && draft.content.trim().length > 0;

  const closeEditor = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  };

  const openCreate = () => {
    setSourceForm(null);
    setEditingId('new');
    setDraft(EMPTY_DRAFT);
  };

  const openCreateFromSource = (name: string, text: string, source: PromptSource) => {
    setSourceForm(null);
    setEditingId('new');
    setDraft({ ...EMPTY_DRAFT, title: name, content: text, source });
  };

  const openEdit = (entry: Prompt) => {
    setSourceForm(null);
    setEditingId(entry.id);
    setDraft(draftFromEntry(entry));
  };

  const showSourceError = (error: PromptSourceError) => {
    toast({
      title: t('promptLibrary.source.loadFailed'),
      description: t(`promptLibrary.source.errors.${error.code}`, {
        detail: error.detail ?? '',
      }),
      variant: 'destructive',
    });
  };

  const handleFileImport = async () => {
    setSourceForm(null);
    setSourceLoading(true);
    try {
      const result = await rpc.promptLibrary.selectFile();
      if (result.status === 'success') {
        openCreateFromSource(result.name, result.text, result.source);
      } else if (result.status === 'error') {
        showSourceError(result.error);
      }
    } finally {
      setSourceLoading(false);
    }
  };

  const handleSourceImport = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!sourceForm) return;
    setSourceLoading(true);
    try {
      const result =
        sourceForm.type === 'url'
          ? await rpc.promptLibrary.loadUrl({
              url: sourceForm.url,
              refreshIntervalMinutes: parseNumber(sourceForm.refreshMinutes),
              timeoutSeconds: parseNumber(sourceForm.timeoutSeconds),
            })
          : await rpc.promptLibrary.loadGit({
              repositoryUrl: sourceForm.repositoryUrl,
              filePath: sourceForm.filePath,
              ref: sourceForm.ref || undefined,
              refreshIntervalMinutes: parseNumber(sourceForm.refreshMinutes),
              timeoutSeconds: parseNumber(sourceForm.timeoutSeconds),
            });
      if (result.status === 'success') {
        openCreateFromSource(result.name, result.text, result.source);
      } else if (result.status === 'error') {
        showSourceError(result.error);
      }
    } finally {
      setSourceLoading(false);
    }
  };

  const handleSave = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    const input = draftToCreateInput(draft);
    const onError = (error: unknown) =>
      toast({
        title: t('promptLibrary.saveFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    if (editingId && editingId !== 'new') {
      updatePrompt.mutate(
        { id: editingId, patch: { ...input, source: input.source ?? null } },
        { onSuccess: closeEditor, onError }
      );
    } else {
      createPrompt.mutate(input, { onSuccess: closeEditor, onError });
    }
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

  const setInjectionEnabled = (entry: Prompt, checked: boolean) => {
    updatePrompt.mutate({ id: entry.id, patch: { injectionEnabled: checked } });
  };

  const moveInjectedPrompt = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= injectedPrompts.length) return;
    const next = injectedPrompts.map((item) => item.id);
    [next[index], next[target]] = [next[target], next[index]];
    reorderPrompts.mutate(next);
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

        <section className={cn(embedded ? 'mt-6' : 'mt-10')}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <h2 className="text-base font-medium text-foreground">
                {t('promptLibrary.collection.title')}
              </h2>
              <p className="mt-1 text-sm leading-6 text-foreground-muted">
                {t('promptLibrary.collection.description')}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={openCreate}>
                <Plus className="size-4" />
                {t('promptLibrary.source.manual')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleFileImport()}
                disabled={sourceLoading}
              >
                <FileText className="size-4" />
                {t('promptLibrary.source.file')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setSourceForm({
                    type: 'url',
                    url: '',
                    refreshMinutes: DEFAULT_REFRESH,
                    timeoutSeconds: DEFAULT_TIMEOUT,
                  })
                }
              >
                <Link className="size-4" />
                {t('promptLibrary.source.url')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setSourceForm({
                    type: 'git',
                    repositoryUrl: '',
                    filePath: '',
                    ref: '',
                    refreshMinutes: DEFAULT_REFRESH,
                    timeoutSeconds: DEFAULT_TIMEOUT,
                  })
                }
              >
                <GitBranch className="size-4" />
                {t('promptLibrary.source.git')}
              </Button>
            </div>
          </div>

          {sourceForm && (
            <form
              onSubmit={handleSourceImport}
              className="mt-5 grid gap-4 rounded-lg border border-border bg-background-secondary p-4"
            >
              {sourceForm.type === 'url' ? (
                <label className="grid gap-1.5">
                  <span className="text-xs text-foreground-muted">
                    {t('promptLibrary.source.urlLabel')}
                  </span>
                  <Input
                    value={sourceForm.url}
                    onChange={(event) =>
                      setSourceForm((current) =>
                        current?.type === 'url' ? { ...current, url: event.target.value } : current
                      )
                    }
                    placeholder={t('promptLibrary.source.urlPlaceholder')}
                    autoFocus
                  />
                </label>
              ) : (
                <>
                  <label className="grid gap-1.5">
                    <span className="text-xs text-foreground-muted">
                      {t('promptLibrary.source.repository')}
                    </span>
                    <Input
                      value={sourceForm.repositoryUrl}
                      onChange={(event) =>
                        setSourceForm((current) =>
                          current?.type === 'git'
                            ? { ...current, repositoryUrl: event.target.value }
                            : current
                        )
                      }
                      placeholder="https://github.com/owner/repository.git"
                      autoFocus
                    />
                  </label>
                  <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
                    <label className="grid gap-1.5">
                      <span className="text-xs text-foreground-muted">
                        {t('promptLibrary.source.filePath')}
                      </span>
                      <Input
                        value={sourceForm.filePath}
                        onChange={(event) =>
                          setSourceForm((current) =>
                            current?.type === 'git'
                              ? { ...current, filePath: event.target.value }
                              : current
                          )
                        }
                        placeholder="prompts/review.md"
                      />
                    </label>
                    <label className="grid gap-1.5">
                      <span className="text-xs text-foreground-muted">
                        {t('promptLibrary.source.ref')}
                      </span>
                      <Input
                        value={sourceForm.ref}
                        onChange={(event) =>
                          setSourceForm((current) =>
                            current?.type === 'git'
                              ? { ...current, ref: event.target.value }
                              : current
                          )
                        }
                        placeholder="main"
                      />
                    </label>
                  </div>
                </>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className="text-xs text-foreground-muted">
                    {t('promptLibrary.source.refreshInterval')}
                  </span>
                  <Input
                    type="number"
                    min={1}
                    value={sourceForm.refreshMinutes}
                    onChange={(event) =>
                      setSourceForm((current) =>
                        current ? { ...current, refreshMinutes: event.target.value } : current
                      )
                    }
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs text-foreground-muted">
                    {t('promptLibrary.source.timeout')}
                  </span>
                  <Input
                    type="number"
                    min={1}
                    value={sourceForm.timeoutSeconds}
                    onChange={(event) =>
                      setSourceForm((current) =>
                        current ? { ...current, timeoutSeconds: event.target.value } : current
                      )
                    }
                  />
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setSourceForm(null)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    sourceLoading ||
                    (sourceForm.type === 'url'
                      ? !sourceForm.url.trim()
                      : !sourceForm.repositoryUrl.trim() || !sourceForm.filePath.trim())
                  }
                >
                  {sourceLoading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : sourceForm.type === 'url' ? (
                    <Link className="size-4" />
                  ) : (
                    <GitBranch className="size-4" />
                  )}
                  {t('promptLibrary.source.load')}
                </Button>
              </div>
            </form>
          )}

          {editorOpen && (
            <form
              onSubmit={handleSave}
              className="mt-5 grid gap-4 rounded-lg border border-border bg-background-secondary p-4"
            >
              {draft.source && (
                <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
                  {draft.source.type === 'file' ? (
                    <FileText className="size-4 shrink-0 text-foreground-muted" />
                  ) : draft.source.type === 'url' ? (
                    <Link className="size-4 shrink-0 text-foreground-muted" />
                  ) : (
                    <GitBranch className="size-4 shrink-0 text-foreground-muted" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground-muted">
                    {sourceTarget(draft.source)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => setDraft((current) => ({ ...current, source: undefined }))}
                  >
                    {t('promptLibrary.source.detach')}
                  </Button>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
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
                    autoFocus
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
                </label>
              </div>
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
                  {t('promptLibrary.form.content')}
                </span>
                <Textarea
                  value={draft.content}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, content: event.target.value }))
                  }
                  readOnly={Boolean(draft.source)}
                  placeholder={t('promptLibrary.form.contentPlaceholder')}
                  className="min-h-40 resize-y font-mono"
                />
                {draft.source && (
                  <span className="text-xs text-foreground-passive">
                    {t('promptLibrary.source.readOnlyHint')}
                  </span>
                )}
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs text-foreground-muted">
                  {t('promptLibrary.form.extraInfo')}
                </span>
                <Textarea
                  value={draft.extraInfo}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, extraInfo: event.target.value }))
                  }
                  placeholder={t('promptLibrary.form.extraInfoPlaceholder')}
                  className="min-h-20 resize-y"
                />
              </label>
              <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-background px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t('promptLibrary.injection.enable')}
                  </p>
                  <p className="mt-0.5 text-xs text-foreground-muted">
                    {t('promptLibrary.injection.enableHint')}
                  </p>
                </div>
                <Switch
                  checked={draft.injectionEnabled}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({ ...current, injectionEnabled: checked }))
                  }
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={closeEditor}>
                  <X className="size-4" />
                  {t('common.cancel')}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!canSave || createPrompt.isPending || updatePrompt.isPending}
                >
                  <Save className="size-4" />
                  {editingId !== 'new' ? t('common.save') : t('common.create')}
                </Button>
              </div>
            </form>
          )}
        </section>

        <section className="mt-10 rounded-lg border border-border bg-background-secondary">
          <div className="flex items-start gap-3 border-b border-border px-4 py-3">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-foreground-muted" />
            <div>
              <h2 className="text-sm font-medium text-foreground">
                {t('promptLibrary.injection.title')}
              </h2>
              <p className="mt-1 text-xs leading-5 text-foreground-muted">
                {t('promptLibrary.injection.description')}
              </p>
            </div>
          </div>
          {injectedPrompts.length === 0 ? (
            <p className="px-4 py-5 text-sm text-foreground-muted">
              {t('promptLibrary.injection.empty')}
            </p>
          ) : (
            <ol>
              {injectedPrompts.map((entry, index) => (
                <li
                  key={entry.id}
                  className="flex items-center gap-3 border-t border-border px-4 py-2.5 first:border-t-0"
                >
                  <span className="w-5 shrink-0 text-center text-xs tabular-nums text-foreground-passive">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {entry.title}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t('promptLibrary.injection.moveUp')}
                    disabled={index === 0 || reorderPrompts.isPending}
                    onClick={() => moveInjectedPrompt(index, -1)}
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t('promptLibrary.injection.moveDown')}
                    disabled={index === injectedPrompts.length - 1 || reorderPrompts.isPending}
                    onClick={() => moveInjectedPrompt(index, 1)}
                  >
                    <ArrowDown className="size-3.5" />
                  </Button>
                  <Switch
                    size="sm"
                    checked
                    aria-label={t('promptLibrary.injection.disable')}
                    onCheckedChange={(checked) => setInjectionEnabled(entry, checked)}
                  />
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="mt-10">
          <h2 className="text-sm font-medium text-foreground">
            {t('promptLibrary.collection.all')}
          </h2>
          <div className="mt-3">
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
                                      <span className="flex items-center gap-2">
                                        <span className="truncate text-sm font-medium text-foreground">
                                          {entry.title}
                                        </span>
                                        {entry.source && (
                                          <span className="shrink-0 rounded bg-background-1 px-1.5 py-0.5 text-[10px] text-foreground-muted">
                                            {t(`promptLibrary.source.type.${entry.source.type}`)}
                                          </span>
                                        )}
                                        {entry.injectionEnabled && (
                                          <span
                                            data-slot="prompt-injection-badge"
                                            className="shrink-0 rounded bg-background-neutral px-1.5 py-0.5 text-[10px] text-foreground-neutral"
                                          >
                                            {t('promptLibrary.injection.badge')}
                                          </span>
                                        )}
                                      </span>
                                      {entry.description && (
                                        <span className="mt-0.5 block truncate text-xs text-foreground-muted">
                                          {entry.description}
                                        </span>
                                      )}
                                    </span>
                                  </button>
                                  <Switch
                                    size="sm"
                                    checked={entry.injectionEnabled}
                                    aria-label={t('promptLibrary.injection.toggle', {
                                      name: entry.title,
                                    })}
                                    onCheckedChange={(checked) =>
                                      setInjectionEnabled(entry, checked)
                                    }
                                  />
                                  <div className="flex shrink-0 items-center gap-1 opacity-70 transition-opacity group-hover/prompt:opacity-100 group-focus-within/prompt:opacity-100">
                                    {entry.source && (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={t('promptLibrary.source.refresh')}
                                        disabled={refreshSource.isPending}
                                        onClick={() =>
                                          refreshSource.mutate(entry.id, {
                                            onSuccess: (result) => {
                                              if (result.status === 'error') {
                                                showSourceError(result.error);
                                              }
                                            },
                                          })
                                        }
                                      >
                                        <RefreshCw
                                          className={cn(
                                            'size-4',
                                            refreshSource.isPending && 'animate-spin'
                                          )}
                                        />
                                      </Button>
                                    )}
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
                                  <div className="grid gap-3 border-t border-border px-3 py-3 pl-14">
                                    {entry.source && (
                                      <p className="truncate text-xs text-foreground-passive">
                                        {sourceTarget(entry.source)}
                                      </p>
                                    )}
                                    <pre className="min-w-0 whitespace-pre-wrap break-words font-mono text-xs text-foreground-passive">
                                      {entry.content}
                                    </pre>
                                    {entry.extraInfo && (
                                      <div className="rounded-md border border-border bg-background px-3 py-2 text-xs leading-5 text-foreground-muted">
                                        <span className="mr-2 font-medium text-foreground">
                                          {t('promptLibrary.form.extraInfo')}
                                        </span>
                                        {isExternalUrl(entry.extraInfo) ? (
                                          <button
                                            type="button"
                                            className="inline-flex items-center gap-1 text-foreground underline underline-offset-2"
                                            onClick={() =>
                                              void rpc.app.openExternal(entry.extraInfo.trim())
                                            }
                                          >
                                            {entry.extraInfo.trim()}
                                            <ExternalLink className="size-3" />
                                          </button>
                                        ) : (
                                          <span className="whitespace-pre-wrap">
                                            {entry.extraInfo}
                                          </span>
                                        )}
                                      </div>
                                    )}
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
      </div>
    </div>
  );
}
