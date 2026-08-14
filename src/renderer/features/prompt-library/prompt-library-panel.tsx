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
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  GitBranch,
  GripVertical,
  LibraryBig,
  Link,
  ListFilter,
  ListTree,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { projectDisplayName, type Project } from '@shared/projects';
import {
  incrementPromptVersion,
  normalizePromptTags,
  PROMPT_SOURCE_DEFAULT_REFRESH_MINUTES,
  PROMPT_SOURCE_DEFAULT_TIMEOUT_SECONDS,
  type Prompt,
  type PromptBindings,
  type PromptCreateInput,
  type PromptSource,
  type PromptSourceError,
  type PromptVersionBump,
} from '@shared/prompt-library';
import type { RuntimeId } from '@shared/runtime-registry';
import type { Workspace } from '@shared/workspaces';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { reorderIdsInVisibleList } from '@renderer/lib/reorder-ids';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Checkbox } from '@renderer/lib/ui/checkbox';
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
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Switch } from '@renderer/lib/ui/switch';
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@renderer/lib/ui/tabs';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';
import { ProjectPromptSection } from './project-prompt-section';
import { PromptLibraryChapter } from './prompt-library-chapter';
import { PromptRuntimeSelector, UserInstructionSection } from './prompt-system-section';
import { collectPromptTags, filterPrompts } from './prompt-tags';
import { PromptVersionHistory } from './prompt-version-history';
import {
  useCreatePrompt,
  useDeletePrompt,
  usePrompts,
  useRefreshPromptSource,
  useRemovePromptTag,
  useReorderPrompts,
  useSetTagInjectionEnabled,
  useUpdatePrompt,
} from './use-prompts';

type PromptDraft = {
  title: string;
  description: string;
  content: string;
  tags: string;
  extraInfo: string;
  injectionEnabled: boolean;
  bindings: PromptBindings;
  source?: PromptSource;
};

type PromptLibraryScope = 'global' | 'project' | 'dynamic';
type PromptStatusFilter = 'all' | 'enabled' | 'disabled';

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
  tags: '',
  extraInfo: '',
  injectionEnabled: false,
  bindings: { global: true, workspaceIds: [], projectIds: [] },
};

const DEFAULT_REFRESH = String(PROMPT_SOURCE_DEFAULT_REFRESH_MINUTES);
const DEFAULT_TIMEOUT = String(PROMPT_SOURCE_DEFAULT_TIMEOUT_SECONDS);

function draftFromEntry(entry: Prompt): PromptDraft {
  return {
    title: entry.title,
    description: entry.description,
    content: entry.content,
    tags: entry.tags.join(', '),
    extraInfo: entry.extraInfo,
    injectionEnabled: entry.injectionEnabled,
    bindings: {
      global: entry.bindings.global,
      workspaceIds: [...entry.bindings.workspaceIds],
      projectIds: [...entry.bindings.projectIds],
    },
    source: entry.source,
  };
}

function parseTagsText(value: string): string[] {
  return normalizePromptTags(value.split(/[\n,，、]/));
}

function draftToCreateInput(draft: PromptDraft): PromptCreateInput {
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    content: draft.content.trim(),
    tags: parseTagsText(draft.tags),
    extraInfo: draft.extraInfo.trim(),
    injectionEnabled: draft.injectionEnabled,
    bindings: {
      global: draft.bindings.global,
      workspaceIds: [...new Set(draft.bindings.workspaceIds)],
      projectIds: [...new Set(draft.bindings.projectIds)],
    },
    source: draft.source,
  };
}

function hasAuthoredChanges(draft: PromptDraft, entry: Prompt | undefined): boolean {
  if (!entry) return false;
  return (
    draft.title.trim() !== entry.title ||
    draft.description.trim() !== entry.description ||
    draft.content.trim() !== entry.content ||
    draft.extraInfo.trim() !== entry.extraInfo
  );
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

const PromptBindingEditor = function PromptBindingEditor({
  bindings,
  onChange,
}: {
  bindings: PromptBindings;
  onChange: (bindings: PromptBindings) => void;
}) {
  const { t } = useTranslation();
  const [availableProjects, setAvailableProjects] = useState<Project[]>([]);
  const [availableWorkspaces, setAvailableWorkspaces] = useState<Workspace[]>([]);
  const [targetQuery, setTargetQuery] = useState('');
  useEffect(() => {
    let active = true;
    void Promise.all([
      rpc.projects.getProjects().catch(() => []),
      rpc.workspaces.listWorkspaces().catch(() => []),
    ]).then(([projects, workspaces]) => {
      if (!active) return;
      setAvailableProjects(projects);
      setAvailableWorkspaces(workspaces);
    });
    return () => {
      active = false;
    };
  }, []);
  const normalizedQuery = targetQuery.trim().toLocaleLowerCase();
  const projects = availableProjects
    .filter((project) => !project.isInternal)
    .map((project) => ({ id: project.id, name: projectDisplayName(project) }))
    .filter(
      (project) => !normalizedQuery || project.name.toLocaleLowerCase().includes(normalizedQuery)
    )
    .sort((left, right) => left.name.localeCompare(right.name));
  const workspaces = availableWorkspaces
    .filter(
      (workspace) =>
        !normalizedQuery || workspace.name.toLocaleLowerCase().includes(normalizedQuery)
    )
    .sort((left, right) => left.name.localeCompare(right.name));

  const toggleBinding = (ids: string[], id: string, checked: boolean): string[] =>
    checked ? [...new Set([...ids, id])] : ids.filter((value) => value !== id);

  return (
    <div className="grid gap-2 rounded-md border border-border bg-background px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{t('promptLibrary.binding.title')}</p>
          <p className="mt-0.5 text-xs text-foreground-muted">{t('promptLibrary.binding.hint')}</p>
        </div>
        <Switch
          checked={bindings.global}
          onCheckedChange={(global) => onChange({ ...bindings, global })}
          aria-label={t('promptLibrary.binding.global')}
        />
      </div>
      <div className="grid gap-1.5 border-t border-border pt-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-foreground-passive" />
          <Input
            value={targetQuery}
            onChange={(event) => setTargetQuery(event.target.value)}
            placeholder={t('promptLibrary.binding.searchPlaceholder')}
            aria-label={t('promptLibrary.binding.search')}
            className="h-7 pl-7 text-xs"
          />
        </div>
        <div className="grid max-h-40 gap-2 overflow-y-auto pr-1">
          <div className="grid gap-0.5">
            <span className="px-1.5 text-[11px] font-medium text-foreground-muted">
              {t('promptLibrary.binding.workspaces')}
            </span>
            {workspaces.length === 0 ? (
              <span className="px-1.5 text-xs text-foreground-passive">
                {t('promptLibrary.binding.noWorkspaces')}
              </span>
            ) : (
              workspaces.map((workspace) => {
                const checked = bindings.workspaceIds.includes(workspace.id);
                return (
                  <label
                    key={workspace.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs text-foreground hover:bg-background-1"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(nextChecked) =>
                        onChange({
                          ...bindings,
                          workspaceIds: toggleBinding(
                            bindings.workspaceIds,
                            workspace.id,
                            nextChecked === true
                          ),
                        })
                      }
                    />
                    <span className="min-w-0 truncate">{workspace.name}</span>
                  </label>
                );
              })
            )}
          </div>
          <div className="grid gap-0.5">
            <span className="px-1.5 text-[11px] font-medium text-foreground-muted">
              {t('promptLibrary.binding.projects')}
            </span>
            {projects.length === 0 ? (
              <span className="px-1.5 text-xs text-foreground-passive">
                {t('promptLibrary.binding.noProjects')}
              </span>
            ) : (
              projects.map((project) => {
                const checked = bindings.projectIds.includes(project.id);
                return (
                  <label
                    key={project.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs text-foreground hover:bg-background-1"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(nextChecked) =>
                        onChange({
                          ...bindings,
                          projectIds: toggleBinding(
                            bindings.projectIds,
                            project.id,
                            nextChecked === true
                          ),
                        })
                      }
                    />
                    <span className="min-w-0 truncate">{project.name}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>
        <p className="text-[11px] text-foreground-passive">
          {t('promptLibrary.binding.selected', {
            workspaces: bindings.workspaceIds.length,
            projects: bindings.projectIds.length,
          })}
        </p>
      </div>
    </div>
  );
};

function SortablePromptRow({
  entry,
  disabled,
  children,
}: {
  entry: Prompt;
  disabled: boolean;
  children: (dragHandle: ReactNode) => ReactNode;
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
    data: { kind: 'prompt' },
    disabled,
  });
  const dragHandle = (
    <button
      ref={setActivatorNodeRef}
      type="button"
      className="flex size-7 shrink-0 touch-none cursor-grab items-center justify-center rounded-md text-foreground-passive outline-none transition-colors hover:bg-background-1 hover:text-foreground active:cursor-grabbing focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed"
      aria-label={t('promptLibrary.reorder', { name: entry.title })}
      title={t('promptLibrary.reorder', { name: entry.title })}
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
      className="group/prompt relative min-w-0 border-t border-border first:border-t-0"
    >
      {children(dragHandle)}
    </li>
  );
}

export function PromptLibraryPanel({
  embedded = false,
  projectId,
  initialAction,
  onInitialActionConsumed,
}: {
  embedded?: boolean;
  /** Preselects the project-scoped instruction and opens the project tab. */
  projectId?: string;
  initialAction?: 'create';
  onInitialActionConsumed?: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const showConfirm = useShowModal('confirmActionModal');
  const { data, isLoading } = usePrompts();
  const createPrompt = useCreatePrompt();
  const updatePrompt = useUpdatePrompt();
  const deletePrompt = useDeletePrompt();
  const reorderPrompts = useReorderPrompts();
  const setTagInjectionEnabled = useSetTagInjectionEnabled();
  const removePromptTag = useRemovePromptTag();
  const refreshSource = useRefreshPromptSource();
  const sortingSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const tagOptionsId = useId();
  const editorRef = useRef<HTMLFormElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PromptDraft>(EMPTY_DRAFT);
  const [versionBump, setVersionBump] = useState<PromptVersionBump>('patch');
  const [sourceForm, setSourceForm] = useState<SourceForm | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [activeRuntimeId, setActiveRuntimeId] = useState<RuntimeId | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projectId ?? null);
  const [activeScope, setActiveScope] = useState<PromptLibraryScope>(
    projectId ? 'project' : 'dynamic'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<PromptStatusFilter>('all');

  useEffect(() => {
    if (!projectId) return;
    setSelectedProjectId(projectId);
    setActiveScope('project');
  }, [projectId]);

  const items = useMemo(() => data ?? [], [data]);
  const tagOptions = useMemo(() => collectPromptTags(items), [items]);
  const visibleItems = useMemo(
    () =>
      filterPrompts(items, {
        query: searchQuery,
        tag: selectedTag ?? undefined,
        status: statusFilter,
      }),
    [items, searchQuery, selectedTag, statusFilter]
  );
  const editorOpen = editingId !== null;
  const editingEntry = items.find((entry) => entry.id === editingId);
  const authoredChanges = hasAuthoredChanges(draft, editingEntry);
  const nextVersion = editingEntry
    ? incrementPromptVersion(editingEntry.version, versionBump)
    : '1.0.0';
  const canSave = draft.title.trim().length > 0 && draft.content.trim().length > 0;
  const selectedTagItems = selectedTag
    ? items.filter((prompt) => prompt.tags.includes(selectedTag))
    : [];
  const selectedTagEnabledCount = selectedTagItems.filter(
    (prompt) => prompt.injectionEnabled
  ).length;

  useEffect(() => {
    if (selectedTag && !tagOptions.includes(selectedTag)) setSelectedTag(null);
  }, [selectedTag, tagOptions]);

  const closeEditor = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setVersionBump('patch');
  };

  const openCreate = useCallback(() => {
    setSourceForm(null);
    setEditingId('new');
    setDraft(EMPTY_DRAFT);
    setVersionBump('patch');
    requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: 'smooth' }));
  }, []);

  useEffect(() => {
    if (initialAction !== 'create') return;
    setActiveScope('dynamic');
    openCreate();
    onInitialActionConsumed?.();
  }, [initialAction, onInitialActionConsumed, openCreate]);

  const openCreateFromSource = (name: string, text: string, source: PromptSource) => {
    setSourceForm(null);
    setEditingId('new');
    setDraft({ ...EMPTY_DRAFT, title: name, content: text, source });
    setVersionBump('patch');
    requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: 'smooth' }));
  };

  const openEdit = (entry: Prompt) => {
    setSourceForm(null);
    setEditingId(entry.id);
    setDraft(draftFromEntry(entry));
    setVersionBump('patch');
    requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: 'smooth' }));
  };

  const showSourceError = (error: PromptSourceError) => {
    toast({
      title: t('promptLibrary.source.loadFailed'),
      description: t(`promptLibrary.source.errors.${error.code}`, { detail: error.detail ?? '' }),
      variant: 'destructive',
    });
  };

  const handleFileImport = async () => {
    setSourceForm(null);
    setSourceLoading(true);
    try {
      const result = await rpc.promptLibrary.selectFile();
      if (result.status === 'success')
        openCreateFromSource(result.name, result.text, result.source);
      else if (result.status === 'error') showSourceError(result.error);
    } finally {
      setSourceLoading(false);
    }
  };

  const handleSourceImport = async (event: FormEvent) => {
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
      if (result.status === 'success')
        openCreateFromSource(result.name, result.text, result.source);
      else if (result.status === 'error') showSourceError(result.error);
    } finally {
      setSourceLoading(false);
    }
  };

  const handleSave = (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    let input: PromptCreateInput;
    try {
      input = draftToCreateInput(draft);
    } catch (error) {
      toast({
        title: t('promptLibrary.saveFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
      return;
    }
    const onError = (error: unknown) =>
      toast({
        title: t('promptLibrary.saveFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    if (editingId && editingId !== 'new') {
      updatePrompt.mutate(
        {
          id: editingId,
          patch: {
            ...input,
            source: input.source ?? null,
            ...(authoredChanges ? { versionBump } : {}),
          },
        },
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

  const handleCopy = (entry: Prompt) => {
    void navigator.clipboard.writeText(entry.content).then(
      () => toast({ title: t('promptLibrary.copied') }),
      () => undefined
    );
  };

  const setInjectionEnabled = (entry: Prompt, checked: boolean) => {
    updatePrompt.mutate({ id: entry.id, patch: { injectionEnabled: checked } });
  };

  const handleTagBulkToggle = (enabled: boolean) => {
    if (!selectedTag) return;
    setTagInjectionEnabled.mutate({ tag: selectedTag, enabled });
  };

  const handleRemoveTag = (tag: string) => {
    const promptCount = items.filter((prompt) => prompt.tags.includes(tag)).length;
    showConfirm({
      title: t('promptLibrary.filters.deleteTagTitle', { tag }),
      description: t('promptLibrary.filters.deleteTagDescription', { tag, count: promptCount }),
      confirmLabel: t('promptLibrary.filters.deleteTagConfirm'),
      onSuccess: () => {
        removePromptTag.mutate(tag, {
          onSuccess: () => {
            if (selectedTag === tag) setSelectedTag(null);
            toast({ title: t('promptLibrary.filters.tagDeleted', { tag }) });
          },
          onError: (error) =>
            toast({
              title: t('promptLibrary.filters.deleteTagFailed'),
              description: error instanceof Error ? error.message : String(error),
              variant: 'destructive',
            }),
        });
      },
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (!event.over) return;
    const currentOrder = items.map((entry) => entry.id);
    const next = reorderIdsInVisibleList(
      currentOrder,
      visibleItems.map((entry) => entry.id),
      String(event.active.id),
      String(event.over.id)
    );
    if (next !== currentOrder) reorderPrompts.mutate(next);
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
        '@container flex min-h-0 min-w-0 flex-1 overflow-x-hidden bg-background text-foreground',
        !embedded && 'h-full min-h-0 overflow-y-auto'
      )}
    >
      <div
        className={cn(
          'flex min-w-0 w-full flex-col',
          !embedded && 'mx-auto max-w-[1060px] px-4 pt-6 @3xl:px-6 @3xl:pt-8 @5xl:px-10 @5xl:pt-12'
        )}
      >
        {!embedded && (
          <h1 className="text-4xl font-normal tracking-normal">{t('promptLibrary.title')}</h1>
        )}

        <Tabs
          value={activeScope}
          onValueChange={(value) => setActiveScope(value as PromptLibraryScope)}
          className={cn('min-w-0', embedded ? 'mt-4' : 'mt-6')}
        >
          <TabsList aria-label={t('promptLibrary.tabs.ariaLabel')} className="w-full max-w-md">
            <TabsIndicator />
            <TabsTab value="global">{t('promptLibrary.tabs.global')}</TabsTab>
            <TabsTab value="project">{t('promptLibrary.tabs.project')}</TabsTab>
            <TabsTab value="dynamic">{t('promptLibrary.tabs.dynamic')}</TabsTab>
          </TabsList>

          <TabsPanel value="global">
            <PromptRuntimeSelector
              runtimeId={activeRuntimeId}
              onRuntimeIdChange={setActiveRuntimeId}
            />
            <UserInstructionSection runtimeId={activeRuntimeId} />
          </TabsPanel>

          <TabsPanel value="project">
            <PromptRuntimeSelector
              runtimeId={activeRuntimeId}
              onRuntimeIdChange={setActiveRuntimeId}
            />
            <ProjectPromptSection
              projectId={selectedProjectId}
              runtimeId={activeRuntimeId}
              onProjectIdChange={setSelectedProjectId}
            />
          </TabsPanel>

          <TabsPanel value="dynamic">
            <PromptLibraryChapter
              dataSlot="prompt-collection-section"
              className="mt-4"
              icon={LibraryBig}
              title={t('promptLibrary.collection.title')}
              description={t('promptLibrary.collection.description')}
              actions={
                <div className="flex flex-wrap items-center gap-2 @3xl:justify-end">
                  <Button type="button" size="sm" onClick={openCreate}>
                    <Plus className="size-4" />
                    {t('promptLibrary.source.manual')}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          aria-label={t('promptLibrary.source.more')}
                          title={t('promptLibrary.source.more')}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>{t('promptLibrary.source.import')}</DropdownMenuLabel>
                        <DropdownMenuItem
                          onClick={() => void handleFileImport()}
                          disabled={sourceLoading}
                        >
                          <FileText />
                          {t('promptLibrary.source.file')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            setSourceForm({
                              type: 'url',
                              url: '',
                              refreshMinutes: DEFAULT_REFRESH,
                              timeoutSeconds: DEFAULT_TIMEOUT,
                            })
                          }
                        >
                          <Link />
                          {t('promptLibrary.source.url')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
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
                          <GitBranch />
                          {t('promptLibrary.source.git')}
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              }
            >
              {sourceForm || editorOpen ? (
                <div className="grid gap-3">
                  {sourceForm ? (
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
                                current
                                  ? { ...current, refreshMinutes: event.target.value }
                                  : current
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
                                current
                                  ? { ...current, timeoutSeconds: event.target.value }
                                  : current
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
                  ) : null}

                  {editorOpen ? (
                    <form
                      ref={editorRef}
                      data-slot="prompt-library-editor"
                      onSubmit={handleSave}
                      className="grid gap-3 rounded-lg border border-border bg-background-secondary p-3"
                    >
                      {draft.source ? (
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
                            onClick={() =>
                              setDraft((current) => ({ ...current, source: undefined }))
                            }
                          >
                            {t('promptLibrary.source.detach')}
                          </Button>
                        </div>
                      ) : null}
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
                            {t('promptLibrary.form.tags')}
                          </span>
                          <Input
                            list={tagOptionsId}
                            value={draft.tags}
                            onChange={(event) =>
                              setDraft((current) => ({ ...current, tags: event.target.value }))
                            }
                            placeholder={t('promptLibrary.form.tagsPlaceholder')}
                          />
                          <span className="text-[11px] leading-4 text-foreground-passive">
                            {t('promptLibrary.form.tagsHint')}
                          </span>
                          <datalist id={tagOptionsId}>
                            {tagOptions.map((tag) => (
                              <option key={tag} value={tag} />
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
                        {draft.source ? (
                          <span className="text-xs text-foreground-passive">
                            {t('promptLibrary.source.readOnlyHint')}
                          </span>
                        ) : null}
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
                      <PromptBindingEditor
                        bindings={draft.bindings}
                        onChange={(bindings) => setDraft((current) => ({ ...current, bindings }))}
                      />
                      {editingEntry ? (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2.5">
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              {t('promptLibrary.versions.saveTitle')}
                            </p>
                            <p className="mt-0.5 text-xs text-foreground-muted">
                              {authoredChanges
                                ? t('promptLibrary.versions.nextVersion', { version: nextVersion })
                                : t('promptLibrary.versions.noAuthoredChanges', {
                                    version: editingEntry.version,
                                  })}
                            </p>
                          </div>
                          <Select
                            value={versionBump}
                            disabled={!authoredChanges}
                            onValueChange={(value) => setVersionBump(value as PromptVersionBump)}
                          >
                            <SelectTrigger
                              size="sm"
                              aria-label={t('promptLibrary.versions.bumpLabel')}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent align="end">
                              <SelectItem value="patch">
                                {t('promptLibrary.versions.bump.patch')}
                              </SelectItem>
                              <SelectItem value="minor">
                                {t('promptLibrary.versions.bump.minor')}
                              </SelectItem>
                              <SelectItem value="major">
                                {t('promptLibrary.versions.bump.major')}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      ) : null}
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
                          {editingId === 'new'
                            ? t('common.create')
                            : authoredChanges
                              ? t('promptLibrary.versions.saveAs', { version: nextVersion })
                              : t('common.save')}
                        </Button>
                      </div>
                    </form>
                  ) : null}
                </div>
              ) : null}
            </PromptLibraryChapter>

            <PromptLibraryChapter
              dataSlot="prompt-list-section"
              className="mt-6"
              icon={ListTree}
              title={t('promptLibrary.collection.all')}
              description={t('promptLibrary.collection.allDescription')}
            >
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-48 flex-1 @2xl:max-w-md">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-foreground-passive" />
                    <Input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder={t('promptLibrary.filters.searchPlaceholder')}
                      aria-label={t('promptLibrary.filters.search')}
                      className="pl-8"
                    />
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={t('promptLibrary.filters.status')}
                        >
                          <ListFilter className="size-3.5" />
                          {t(`promptLibrary.filters.${statusFilter}`)}
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuRadioGroup
                        value={statusFilter}
                        onValueChange={(value) => setStatusFilter(value as PromptStatusFilter)}
                      >
                        <DropdownMenuRadioItem value="all">
                          {t('promptLibrary.filters.all')}
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="enabled">
                          {t('promptLibrary.filters.enabled')}
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="disabled">
                          {t('promptLibrary.filters.disabled')}
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {tagOptions.length > 0 ? (
                  <div
                    data-slot="prompt-tag-badges"
                    className="flex flex-wrap items-center gap-1.5"
                  >
                    <span className="mr-1 inline-flex items-center gap-1 text-xs text-foreground-muted">
                      <Tag className="size-3.5" />
                      {t('promptLibrary.filters.tagListLabel')}
                    </span>
                    {tagOptions.map((tag) => (
                      <Badge
                        key={tag}
                        data-slot="prompt-tag-badge"
                        data-tag={tag}
                        variant={selectedTag === tag ? 'secondary' : 'outline'}
                        className={cn('p-0', removePromptTag.isPending && 'opacity-60')}
                      >
                        <button
                          type="button"
                          aria-pressed={selectedTag === tag}
                          onClick={() =>
                            setSelectedTag((current) => (current === tag ? null : tag))
                          }
                          className="max-w-40 truncate px-2 py-1 text-left outline-none hover:bg-background-1 focus-visible:bg-background-1"
                        >
                          {tag}
                        </button>
                        <button
                          type="button"
                          aria-label={t('promptLibrary.filters.deleteTagAria', { tag })}
                          title={t('promptLibrary.filters.deleteTagAria', { tag })}
                          disabled={removePromptTag.isPending}
                          onClick={() => handleRemoveTag(tag)}
                          className="flex size-5 items-center justify-center border-l border-current/15 text-foreground-muted outline-none transition-colors hover:text-destructive focus-visible:bg-background-1"
                        >
                          <X className="size-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-foreground-muted">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>
                      {t('promptLibrary.filters.resultCount', { count: visibleItems.length })}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedTag ? (
                      <>
                        <span>
                          {t('promptLibrary.filters.tagEnabledCount', {
                            enabled: selectedTagEnabledCount,
                            count: selectedTagItems.length,
                          })}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          disabled={
                            setTagInjectionEnabled.isPending || selectedTagItems.length === 0
                          }
                          onClick={() => handleTagBulkToggle(true)}
                        >
                          <Check className="size-3.5" />
                          {t('promptLibrary.filters.enableTag')}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          disabled={
                            setTagInjectionEnabled.isPending || selectedTagItems.length === 0
                          }
                          onClick={() => handleTagBulkToggle(false)}
                        >
                          {t('promptLibrary.filters.disableTag')}
                        </Button>
                      </>
                    ) : null}
                    {searchQuery || selectedTag || statusFilter !== 'all' ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => {
                          setSearchQuery('');
                          setSelectedTag(null);
                          setStatusFilter('all');
                        }}
                      >
                        <X className="size-3.5" />
                        {t('promptLibrary.filters.clear')}
                      </Button>
                    ) : null}
                  </div>
                </div>

                {items.length === 0 ? (
                  <p className="text-sm text-foreground-muted">{t('promptLibrary.empty')}</p>
                ) : visibleItems.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-3 py-5 text-sm text-foreground-muted">
                    {t('promptLibrary.filters.empty')}
                  </p>
                ) : (
                  <DndContext
                    sensors={sortingSensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext
                      items={visibleItems.map((entry) => entry.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <ul className="min-w-0 overflow-hidden rounded-lg border border-border bg-background-secondary">
                        {visibleItems.map((entry) => {
                          const isOpen = expandedIds.has(entry.id);
                          return (
                            <SortablePromptRow
                              key={entry.id}
                              entry={entry}
                              disabled={reorderPrompts.isPending}
                            >
                              {(promptDragHandle) => (
                                <>
                                  <div className="flex min-w-0 items-center gap-2 px-3 py-2.5">
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
                                        <span className="flex min-w-0 items-center gap-2">
                                          <span className="truncate text-sm font-medium text-foreground">
                                            {entry.title}
                                          </span>
                                          <span className="shrink-0 rounded bg-background-1 px-1.5 py-0.5 text-[10px] text-foreground-muted">
                                            v{entry.version}
                                          </span>
                                          {entry.source ? (
                                            <span className="shrink-0 rounded bg-background-1 px-1.5 py-0.5 text-[10px] text-foreground-muted">
                                              {t(`promptLibrary.source.type.${entry.source.type}`)}
                                            </span>
                                          ) : null}
                                          <span className="shrink-0 rounded bg-background-1 px-1.5 py-0.5 text-[10px] text-foreground-muted">
                                            {entry.bindings.global
                                              ? t('promptLibrary.binding.globalShort')
                                              : entry.bindings.workspaceIds.length > 0 ||
                                                  entry.bindings.projectIds.length > 0
                                                ? t('promptLibrary.binding.scopedShort', {
                                                    workspaces: entry.bindings.workspaceIds.length,
                                                    projects: entry.bindings.projectIds.length,
                                                  })
                                                : t('promptLibrary.binding.unboundShort')}
                                          </span>
                                        </span>
                                        {entry.description ? (
                                          <span className="mt-0.5 block truncate text-xs text-foreground-muted">
                                            {entry.description}
                                          </span>
                                        ) : null}
                                        {entry.tags.length > 0 ? (
                                          <span className="mt-1 flex min-w-0 flex-wrap gap-1">
                                            {entry.tags.map((tag) => (
                                              <Badge
                                                key={tag}
                                                variant={
                                                  selectedTag === tag ? 'secondary' : 'outline'
                                                }
                                                className="max-w-36 truncate"
                                              >
                                                {tag}
                                              </Badge>
                                            ))}
                                          </span>
                                        ) : null}
                                      </span>
                                    </button>
                                    <Switch
                                      size="sm"
                                      checked={entry.injectionEnabled}
                                      disabled={updatePrompt.isPending}
                                      aria-label={t('promptLibrary.injection.toggle', {
                                        name: entry.title,
                                      })}
                                      onCheckedChange={(checked) =>
                                        setInjectionEnabled(entry, checked)
                                      }
                                    />
                                    <DropdownMenu>
                                      <DropdownMenuTrigger
                                        render={
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-sm"
                                            aria-label={t('promptLibrary.actions.more', {
                                              name: entry.title,
                                            })}
                                            title={t('promptLibrary.actions.more', {
                                              name: entry.title,
                                            })}
                                          >
                                            <MoreHorizontal className="size-4" />
                                          </Button>
                                        }
                                      />
                                      <DropdownMenuContent align="end" className="w-44">
                                        <DropdownMenuItem onClick={() => handleCopy(entry)}>
                                          <Copy />
                                          {t('promptLibrary.copy')}
                                        </DropdownMenuItem>
                                        {entry.source ? (
                                          <DropdownMenuItem
                                            onClick={() =>
                                              refreshSource.mutate(entry.id, {
                                                onSuccess: (result) => {
                                                  if (result.status === 'error')
                                                    showSourceError(result.error);
                                                },
                                              })
                                            }
                                            disabled={refreshSource.isPending}
                                          >
                                            <RefreshCw />
                                            {t('promptLibrary.source.refresh')}
                                          </DropdownMenuItem>
                                        ) : null}
                                        <DropdownMenuItem onClick={() => openEdit(entry)}>
                                          <Pencil />
                                          {t('common.edit')}
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          variant="destructive"
                                          onClick={() => handleDelete(entry)}
                                        >
                                          <Trash2 />
                                          {t('common.delete')}
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                  {isOpen ? (
                                    <div className="grid min-w-0 gap-3 border-t border-border px-3 py-3 @3xl:pl-14">
                                      {entry.source ? (
                                        <p className="truncate text-xs text-foreground-passive">
                                          {sourceTarget(entry.source)}
                                        </p>
                                      ) : null}
                                      <div
                                        data-slot="prompt-library-detail-content"
                                        role="region"
                                        aria-label={t('promptLibrary.form.content')}
                                        tabIndex={0}
                                        className="h-56 min-h-0 min-w-0 overflow-y-auto overscroll-contain rounded-md border border-border bg-background px-3 py-2.5 text-xs leading-5 text-foreground-muted"
                                      >
                                        <MarkdownRenderer
                                          content={entry.content}
                                          variant="compact"
                                          annotations={false}
                                          className="min-w-0 break-words"
                                        />
                                      </div>
                                      {entry.extraInfo ? (
                                        <div className="min-w-0 break-words rounded-md border border-border bg-background px-3 py-2 text-xs leading-5 text-foreground-muted">
                                          <span className="mr-2 font-medium text-foreground">
                                            {t('promptLibrary.form.extraInfo')}
                                          </span>
                                          {isExternalUrl(entry.extraInfo) ? (
                                            <button
                                              type="button"
                                              className="inline-flex max-w-full break-all text-left text-foreground underline underline-offset-2"
                                              onClick={() =>
                                                void rpc.app.openExternal(entry.extraInfo.trim())
                                              }
                                            >
                                              {entry.extraInfo.trim()}
                                              <ExternalLink className="size-3" />
                                            </button>
                                          ) : (
                                            <span className="whitespace-pre-wrap break-words">
                                              {entry.extraInfo}
                                            </span>
                                          )}
                                        </div>
                                      ) : null}
                                      <PromptVersionHistory prompt={entry} />
                                    </div>
                                  ) : null}
                                </>
                              )}
                            </SortablePromptRow>
                          );
                        })}
                      </ul>
                    </SortableContext>
                  </DndContext>
                )}
              </div>
            </PromptLibraryChapter>
          </TabsPanel>
        </Tabs>
        <div
          data-slot="prompt-library-bottom-space"
          aria-hidden
          className={cn('shrink-0', embedded ? 'h-8' : 'h-24')}
        />
      </div>
    </div>
  );
}
