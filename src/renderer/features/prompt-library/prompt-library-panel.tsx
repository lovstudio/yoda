import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
  GitBranch,
  GripVertical,
  LibraryBig,
  Link,
  ListTree,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PROMPT_SOURCE_DEFAULT_REFRESH_MINUTES,
  PROMPT_SOURCE_DEFAULT_TIMEOUT_SECONDS,
  type Prompt,
  type PromptCreateInput,
  type PromptSource,
  type PromptSourceError,
} from '@shared/prompt-library';
import type { RuntimeId } from '@shared/runtime-registry';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { Input } from '@renderer/lib/ui/input';
import { Switch } from '@renderer/lib/ui/switch';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';
import { ProjectPromptSection } from './project-prompt-section';
import {
  getNamedPromptGroups,
  groupPrompts,
  reorderPromptIds,
  UNGROUPED_PROMPT_GROUP,
} from './prompt-groups';
import { PromptLibraryChapter } from './prompt-library-chapter';
import { PromptRuntimeSelector, UserInstructionSection } from './prompt-system-section';
import {
  useCreatePrompt,
  useCreatePromptGroup,
  useDeletePrompt,
  usePromptGroups,
  usePrompts,
  useRefreshPromptSource,
  useRenamePromptGroup,
  useReorderPromptGroups,
  useReorderPrompts,
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
const UNGROUPED_MENU_VALUE = 'prompt-library:ungrouped';
const GROUP_SORTABLE_ID_PREFIX = 'prompt-library:group:';

function promptGroupSortableId(groupName: string): string {
  return `${GROUP_SORTABLE_ID_PREFIX}${groupName}`;
}

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

function SortablePromptGroup({
  groupName,
  disabled,
  children,
}: {
  groupName: string;
  disabled: boolean;
  children: (dragHandle: React.ReactNode) => React.ReactNode;
}) {
  const { t } = useTranslation();
  const isUngrouped = groupName === UNGROUPED_PROMPT_GROUP;
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: promptGroupSortableId(groupName),
    data: { kind: 'group', groupName },
    disabled: disabled || isUngrouped,
  });
  const dragHandle = isUngrouped ? null : (
    <button
      ref={setActivatorNodeRef}
      type="button"
      className="ml-1 flex size-8 shrink-0 touch-none cursor-grab items-center justify-center rounded-md text-foreground-passive outline-none transition-colors hover:bg-background-1 hover:text-foreground active:cursor-grabbing focus-visible:ring-1 focus-visible:ring-ring"
      aria-label={t('promptLibrary.groups.reorderGroup', { name: groupName })}
      title={t('promptLibrary.groups.reorderGroup', { name: groupName })}
      disabled={disabled}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="size-4" />
    </button>
  );

  return (
    <li
      ref={setNodeRef}
      data-slot="prompt-group"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.45 : 1,
        zIndex: isDragging ? 1 : 'auto',
      }}
      className="relative overflow-hidden rounded-lg border border-border bg-background-secondary"
    >
      {children(dragHandle)}
    </li>
  );
}

function SortablePromptRow({
  entry,
  groupName,
  disabled,
  children,
}: {
  entry: Prompt;
  groupName: string;
  disabled: boolean;
  children: (dragHandle: React.ReactNode) => React.ReactNode;
}) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: entry.id,
    data: { kind: 'prompt', groupName },
    disabled,
  });
  const dragHandle = (
    <button
      ref={setActivatorNodeRef}
      type="button"
      className="flex size-7 shrink-0 touch-none cursor-grab items-center justify-center rounded-md text-foreground-passive outline-none transition-colors hover:bg-background-1 hover:text-foreground active:cursor-grabbing focus-visible:ring-1 focus-visible:ring-ring"
      aria-label={t('promptLibrary.groups.reorderPrompt', { name: entry.title })}
      title={t('promptLibrary.groups.reorderPrompt', { name: entry.title })}
      disabled={disabled}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="size-3.5" />
    </button>
  );

  return (
    <li
      ref={setNodeRef}
      data-slot="prompt-library-row"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.45 : 1,
        zIndex: isDragging ? 1 : 'auto',
      }}
      className="group/prompt relative border-t border-border first:border-t-0"
    >
      {children(dragHandle)}
    </li>
  );
}

export function PromptLibraryPanel({
  embedded = false,
  projectId,
}: {
  embedded?: boolean;
  /** Preselects the project-scoped instruction and prompt section. */
  projectId?: string;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const showConfirm = useShowModal('confirmActionModal');
  const { data, isLoading } = usePrompts();
  const { data: persistedGroupNames, isLoading: groupsLoading } = usePromptGroups();
  const createGroup = useCreatePromptGroup();
  const renameGroup = useRenamePromptGroup();
  const createPrompt = useCreatePrompt();
  const updatePrompt = useUpdatePrompt();
  const deletePrompt = useDeletePrompt();
  const reorderGroups = useReorderPromptGroups();
  const reorderPrompts = useReorderPrompts();
  const refreshSource = useRefreshPromptSource();
  const sortingSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const groupOptionsId = useId();
  const editorRef = useRef<HTMLFormElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PromptDraft>(EMPTY_DRAFT);
  const [sourceForm, setSourceForm] = useState<SourceForm | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [groupFormOpen, setGroupFormOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [moveAfterCreateId, setMoveAfterCreateId] = useState<string | null>(null);
  const [renamingGroupName, setRenamingGroupName] = useState<string | null>(null);
  const [nextGroupName, setNextGroupName] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [activeRuntimeId, setActiveRuntimeId] = useState<RuntimeId | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projectId ?? null);

  useEffect(() => {
    if (projectId) setSelectedProjectId(projectId);
  }, [projectId]);

  const items = useMemo(() => data ?? [], [data]);
  const groups = useMemo(
    () => groupPrompts(items, persistedGroupNames ?? []),
    [items, persistedGroupNames]
  );
  const namedGroups = useMemo(
    () => getNamedPromptGroups(items, persistedGroupNames ?? []),
    [items, persistedGroupNames]
  );
  const editorOpen = editingId !== null;
  const canSave = draft.title.trim().length > 0 && draft.content.trim().length > 0;
  const normalizedNewGroupName = newGroupName.trim();
  const canCreateGroup =
    normalizedNewGroupName.length > 0 && !namedGroups.includes(normalizedNewGroupName);
  const normalizedNextGroupName = nextGroupName.trim();
  const canRenameGroup =
    renamingGroupName !== null &&
    normalizedNextGroupName.length > 0 &&
    normalizedNextGroupName !== renamingGroupName &&
    !namedGroups.includes(normalizedNextGroupName);

  const closeEditor = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  };

  const openCreate = () => {
    setSourceForm(null);
    setEditingId('new');
    setDraft(EMPTY_DRAFT);
  };

  const openCreateInGroup = (groupName: string) => {
    setSourceForm(null);
    setEditingId('new');
    setDraft({ ...EMPTY_DRAFT, groupName });
    setCollapsedGroups((current) => {
      const next = new Set(current);
      next.delete(groupName);
      return next;
    });
    requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
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

  const openGroupCreator = (promptId: string | null = null) => {
    setMoveAfterCreateId(promptId);
    setNewGroupName('');
    setGroupFormOpen(true);
  };

  const closeGroupCreator = () => {
    setGroupFormOpen(false);
    setNewGroupName('');
    setMoveAfterCreateId(null);
  };

  const openGroupRenamer = (groupName: string) => {
    setRenamingGroupName(groupName);
    setNextGroupName(groupName);
    setCollapsedGroups((current) => {
      const next = new Set(current);
      next.delete(groupName);
      return next;
    });
  };

  const closeGroupRenamer = () => {
    setRenamingGroupName(null);
    setNextGroupName('');
  };

  const movePromptToGroup = (entry: Prompt, groupName: string) => {
    if (entry.groupName.trim() === groupName) return;
    updatePrompt.mutate(
      { id: entry.id, patch: { groupName } },
      {
        onSuccess: () => {
          setCollapsedGroups((current) => {
            const next = new Set(current);
            next.delete(groupName);
            return next;
          });
          if (editingId === entry.id) {
            setDraft((current) => ({ ...current, groupName }));
          }
        },
      }
    );
  };

  const handleCreateGroup = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canCreateGroup) return;
    const groupName = normalizedNewGroupName;
    const promptToMove = moveAfterCreateId
      ? items.find((entry) => entry.id === moveAfterCreateId)
      : undefined;
    createGroup.mutate(groupName, {
      onSuccess: () => {
        setCollapsedGroups((current) => {
          const next = new Set(current);
          next.delete(groupName);
          return next;
        });
        if (promptToMove) movePromptToGroup(promptToMove, groupName);
        closeGroupCreator();
      },
      onError: (error) =>
        toast({
          title: t('promptLibrary.groups.createFailed'),
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        }),
    });
  };

  const handleRenameGroup = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canRenameGroup || !renamingGroupName) return;
    const currentName = renamingGroupName;
    const renamedName = normalizedNextGroupName;
    renameGroup.mutate(
      { currentName, nextName: renamedName },
      {
        onSuccess: () => {
          setCollapsedGroups((current) => {
            if (!current.has(currentName)) return current;
            const next = new Set(current);
            next.delete(currentName);
            next.add(renamedName);
            return next;
          });
          setDraft((current) =>
            current.groupName.trim() === currentName
              ? { ...current, groupName: renamedName }
              : current
          );
          closeGroupRenamer();
        },
        onError: (error) =>
          toast({
            title: t('promptLibrary.groups.renameFailed'),
            description: error instanceof Error ? error.message : String(error),
            variant: 'destructive',
          }),
      }
    );
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

  const handleGroupDragEnd = (event: DragEndEvent) => {
    if (!event.over) return;
    const activeData = event.active.data.current;
    const overData = event.over.data.current;
    if (activeData?.kind !== 'group' || overData?.kind !== 'group') return;
    const activeGroupName = String(activeData.groupName);
    const overGroupName = String(overData.groupName);
    if (
      !activeGroupName ||
      !overGroupName ||
      activeGroupName === UNGROUPED_PROMPT_GROUP ||
      overGroupName === UNGROUPED_PROMPT_GROUP
    ) {
      return;
    }
    const next = reorderPromptIds(namedGroups, activeGroupName, overGroupName);
    if (next !== namedGroups) reorderGroups.mutate(next);
  };

  const handlePromptDragEnd = (groupName: string, ids: string[], event: DragEndEvent) => {
    if (!event.over) return;
    const next = reorderPromptIds(ids, String(event.active.id), String(event.over.id));
    if (next !== ids) reorderPrompts.mutate({ groupName, ids: next });
  };

  if (isLoading || groupsLoading) {
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
        className={cn('flex w-full flex-col', !embedded && 'mx-auto max-w-[1060px] px-10 pt-12')}
      >
        {!embedded && (
          <h1 className="text-4xl font-normal tracking-normal">{t('promptLibrary.title')}</h1>
        )}

        <PromptLibraryChapter
          dataSlot="prompt-collection-section"
          className={cn(embedded ? 'mt-6' : 'mt-8')}
          icon={LibraryBig}
          title={t('promptLibrary.collection.title')}
          description={t('promptLibrary.collection.description')}
          actions={
            <div className="flex flex-wrap items-center gap-2 @3xl:justify-end">
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
          }
        >
          {sourceForm || editorOpen ? (
            <div className="grid gap-3">
              {sourceForm && (
                <form
                  onSubmit={handleSourceImport}
                  className="grid gap-3 rounded-lg border border-border bg-background-secondary p-3"
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
                            current?.type === 'url'
                              ? { ...current, url: event.target.value }
                              : current
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
                      <div className="grid gap-3 @2xl:grid-cols-[1fr_180px]">
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
                  <div className="grid gap-3 @2xl:grid-cols-2">
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
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSourceForm(null)}
                    >
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
                  ref={editorRef}
                  data-slot="prompt-library-editor"
                  onSubmit={handleSave}
                  className="grid gap-3 rounded-lg border border-border bg-background-secondary p-3"
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
                  <div className="grid gap-3 @2xl:grid-cols-2">
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
            </div>
          ) : null}
        </PromptLibraryChapter>

        <PromptRuntimeSelector runtimeId={activeRuntimeId} onRuntimeIdChange={setActiveRuntimeId} />
        <UserInstructionSection runtimeId={activeRuntimeId} />
        <ProjectPromptSection
          projectId={selectedProjectId}
          runtimeId={activeRuntimeId}
          onProjectIdChange={setSelectedProjectId}
        />

        <PromptLibraryChapter
          dataSlot="prompt-list-section"
          className="mt-6"
          icon={ListTree}
          title={t('promptLibrary.collection.all')}
          description={t('promptLibrary.collection.allDescription')}
          actions={
            <Button type="button" variant="outline" size="sm" onClick={() => openGroupCreator()}>
              <FolderPlus className="size-4" />
              {t('promptLibrary.groups.create')}
            </Button>
          }
        >
          {groupFormOpen && (
            <form
              data-slot="prompt-group-form"
              onSubmit={handleCreateGroup}
              className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-background-secondary p-3"
            >
              <label className="grid min-w-48 flex-1 gap-1.5">
                <span className="text-xs font-medium text-foreground">
                  {moveAfterCreateId
                    ? t('promptLibrary.groups.createAndMove')
                    : t('promptLibrary.groups.create')}
                </span>
                <Input
                  value={newGroupName}
                  onChange={(event) => setNewGroupName(event.target.value)}
                  placeholder={t('promptLibrary.groups.namePlaceholder')}
                  autoFocus
                />
              </label>
              <Button type="button" variant="ghost" size="sm" onClick={closeGroupCreator}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={!canCreateGroup || createGroup.isPending}>
                <FolderPlus className="size-4" />
                {moveAfterCreateId
                  ? t('promptLibrary.groups.createAndMoveAction')
                  : t('common.create')}
              </Button>
            </form>
          )}

          <div className="mt-3">
            {groups.length === 0 ? (
              <p className="text-sm text-foreground-muted">{t('promptLibrary.empty')}</p>
            ) : (
              <DndContext
                sensors={sortingSensors}
                collisionDetection={closestCenter}
                onDragEnd={handleGroupDragEnd}
              >
                <SortableContext
                  items={groups.map((group) => promptGroupSortableId(group.name))}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="grid gap-2">
                    {groups.map((group) => {
                      const groupIsOpen = !collapsedGroups.has(group.name);
                      const groupLabel =
                        group.name === UNGROUPED_PROMPT_GROUP
                          ? t('promptLibrary.groups.ungrouped')
                          : group.name;
                      return (
                        <SortablePromptGroup
                          key={group.name || 'ungrouped'}
                          groupName={group.name}
                          disabled={reorderGroups.isPending}
                        >
                          {(groupDragHandle) => (
                            <>
                              <div className="flex min-w-0 items-center">
                                {groupDragHandle}
                                <button
                                  type="button"
                                  onClick={() => toggleGroup(group.name)}
                                  aria-expanded={groupIsOpen}
                                  className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left outline-none transition-colors hover:bg-background-1 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border"
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
                                </button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={t('promptLibrary.groups.createPrompt', {
                                    name: groupLabel,
                                  })}
                                  title={t('promptLibrary.groups.createPrompt', {
                                    name: groupLabel,
                                  })}
                                  onClick={() => openCreateInGroup(group.name)}
                                >
                                  <Plus className="size-4" />
                                </Button>
                                {group.name !== UNGROUPED_PROMPT_GROUP && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={t('promptLibrary.groups.rename', {
                                      name: groupLabel,
                                    })}
                                    title={t('promptLibrary.groups.rename', {
                                      name: groupLabel,
                                    })}
                                    onClick={() => openGroupRenamer(group.name)}
                                  >
                                    <Pencil className="size-4" />
                                  </Button>
                                )}
                              </div>

                              {renamingGroupName === group.name && (
                                <form
                                  data-slot="prompt-group-rename-form"
                                  onSubmit={handleRenameGroup}
                                  className="flex flex-wrap items-end gap-2 border-t border-border bg-background px-3 py-3"
                                >
                                  <label className="grid min-w-48 flex-1 gap-1.5">
                                    <span className="text-xs font-medium text-foreground">
                                      {t('promptLibrary.groups.renameTitle', {
                                        name: groupLabel,
                                      })}
                                    </span>
                                    <Input
                                      value={nextGroupName}
                                      onChange={(event) => setNextGroupName(event.target.value)}
                                      placeholder={t('promptLibrary.groups.namePlaceholder')}
                                      autoFocus
                                    />
                                  </label>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={closeGroupRenamer}
                                  >
                                    {t('common.cancel')}
                                  </Button>
                                  <Button
                                    type="submit"
                                    size="sm"
                                    disabled={!canRenameGroup || renameGroup.isPending}
                                  >
                                    <Save className="size-4" />
                                    {t('common.save')}
                                  </Button>
                                </form>
                              )}

                              {groupIsOpen &&
                                (group.prompts.length === 0 ? (
                                  <p className="border-t border-border px-8 py-4 text-xs text-foreground-muted">
                                    {t('promptLibrary.groups.empty')}
                                  </p>
                                ) : (
                                  <DndContext
                                    sensors={sortingSensors}
                                    collisionDetection={closestCenter}
                                    onDragEnd={(event) =>
                                      handlePromptDragEnd(
                                        group.name,
                                        group.prompts.map((entry) => entry.id),
                                        event
                                      )
                                    }
                                  >
                                    <SortableContext
                                      items={group.prompts.map((entry) => entry.id)}
                                      strategy={verticalListSortingStrategy}
                                    >
                                      <ul className="border-t border-border">
                                        {group.prompts.map((entry) => {
                                          const isOpen = expandedIds.has(entry.id);
                                          return (
                                            <SortablePromptRow
                                              key={entry.id}
                                              entry={entry}
                                              groupName={group.name}
                                              disabled={reorderPrompts.isPending}
                                            >
                                              {(promptDragHandle) => (
                                                <>
                                                  <div className="flex items-center gap-2 px-3 py-2.5 pl-7">
                                                    {promptDragHandle}
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
                                                              {t(
                                                                `promptLibrary.source.type.${entry.source.type}`
                                                              )}
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
                                                      disabled={updatePrompt.isPending}
                                                      aria-label={t(
                                                        'promptLibrary.injection.toggle',
                                                        {
                                                          name: entry.title,
                                                        }
                                                      )}
                                                      onCheckedChange={(checked) =>
                                                        setInjectionEnabled(entry, checked)
                                                      }
                                                    />
                                                    <div className="flex shrink-0 items-center gap-1 opacity-70 transition-opacity group-hover/prompt:opacity-100 group-focus-within/prompt:opacity-100">
                                                      <DropdownMenu>
                                                        <DropdownMenuTrigger
                                                          render={
                                                            <Button
                                                              type="button"
                                                              variant="ghost"
                                                              size="icon-sm"
                                                              aria-label={t(
                                                                'promptLibrary.groups.move',
                                                                {
                                                                  name: entry.title,
                                                                }
                                                              )}
                                                              title={t(
                                                                'promptLibrary.groups.move',
                                                                {
                                                                  name: entry.title,
                                                                }
                                                              )}
                                                              disabled={updatePrompt.isPending}
                                                            >
                                                              <FolderInput className="size-4" />
                                                            </Button>
                                                          }
                                                        />
                                                        <DropdownMenuContent
                                                          align="end"
                                                          className="w-56"
                                                        >
                                                          <DropdownMenuGroup>
                                                            <DropdownMenuLabel>
                                                              {t('promptLibrary.groups.moveTo')}
                                                            </DropdownMenuLabel>
                                                            <DropdownMenuRadioGroup
                                                              value={
                                                                entry.groupName.trim() ||
                                                                UNGROUPED_MENU_VALUE
                                                              }
                                                            >
                                                              <DropdownMenuRadioItem
                                                                value={UNGROUPED_MENU_VALUE}
                                                                closeOnClick
                                                                onClick={() =>
                                                                  movePromptToGroup(
                                                                    entry,
                                                                    UNGROUPED_PROMPT_GROUP
                                                                  )
                                                                }
                                                              >
                                                                {t(
                                                                  'promptLibrary.groups.ungrouped'
                                                                )}
                                                              </DropdownMenuRadioItem>
                                                              {namedGroups.map((groupName) => (
                                                                <DropdownMenuRadioItem
                                                                  key={groupName}
                                                                  value={groupName}
                                                                  closeOnClick
                                                                  onClick={() =>
                                                                    movePromptToGroup(
                                                                      entry,
                                                                      groupName
                                                                    )
                                                                  }
                                                                >
                                                                  {groupName}
                                                                </DropdownMenuRadioItem>
                                                              ))}
                                                            </DropdownMenuRadioGroup>
                                                          </DropdownMenuGroup>
                                                          <DropdownMenuSeparator />
                                                          <DropdownMenuItem
                                                            onClick={() =>
                                                              openGroupCreator(entry.id)
                                                            }
                                                          >
                                                            <FolderPlus className="size-4" />
                                                            {t(
                                                              'promptLibrary.groups.createAndMove'
                                                            )}
                                                          </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                      </DropdownMenu>
                                                      {entry.source && (
                                                        <Button
                                                          type="button"
                                                          variant="ghost"
                                                          size="icon-sm"
                                                          aria-label={t(
                                                            'promptLibrary.source.refresh'
                                                          )}
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
                                                              refreshSource.isPending &&
                                                                'animate-spin'
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
                                                                void rpc.app.openExternal(
                                                                  entry.extraInfo.trim()
                                                                )
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
                                                </>
                                              )}
                                            </SortablePromptRow>
                                          );
                                        })}
                                      </ul>
                                    </SortableContext>
                                  </DndContext>
                                ))}
                            </>
                          )}
                        </SortablePromptGroup>
                      );
                    })}
                  </ul>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </PromptLibraryChapter>
        <div
          data-slot="prompt-library-bottom-space"
          aria-hidden
          className={cn('shrink-0', embedded ? 'h-8' : 'h-24')}
        />
      </div>
    </div>
  );
}
