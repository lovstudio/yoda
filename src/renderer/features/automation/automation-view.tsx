import {
  Bot,
  Circle,
  Loader2,
  PauseCircle,
  Pencil,
  Play,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AutomationEntry } from '@shared/app-settings';
import { INTERNAL_PROJECT_ID } from '@shared/projects';
import { isValidRuntimeId, RUNTIMES, type RuntimeId } from '@shared/runtime-registry';
import { ensureUniqueTaskSlug } from '@shared/task-name';
import {
  asMounted,
  getProjectManagerStore,
} from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { initialConversationTitle } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { useRuntimeAutoApproveDefaults } from '@renderer/features/tasks/hooks/useRuntimeAutoApproveDefaults';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Textarea } from '@renderer/lib/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';

type AutomationDraft = {
  title: string;
  workspaceName: string;
  runtime: RuntimeId;
  scheduleLabel: string;
  prompt: string;
  status: AutomationEntry['status'];
};

const DEFAULT_PROVIDER: RuntimeId = 'codex';

function makeDraft(runtime: RuntimeId): AutomationDraft {
  return {
    title: '',
    workspaceName: 'Yoda',
    runtime,
    scheduleLabel: '',
    prompt: '',
    status: 'active',
  };
}

function draftFromEntry(entry: AutomationEntry): AutomationDraft {
  return {
    title: entry.title,
    workspaceName: entry.workspaceName,
    runtime: entry.runtime,
    scheduleLabel: entry.scheduleLabel,
    prompt: entry.prompt,
    status: entry.status,
  };
}

function entryFromDraft(draft: AutomationDraft, existing?: AutomationEntry): AutomationEntry {
  const now = new Date().toISOString();
  return {
    id: existing?.id ?? crypto.randomUUID(),
    title: draft.title.trim(),
    workspaceName: draft.workspaceName.trim(),
    runtime: draft.runtime,
    scheduleLabel: draft.scheduleLabel.trim(),
    prompt: draft.prompt.trim(),
    status: draft.status,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastRunAt: existing?.lastRunAt ?? null,
  };
}

export function AutomationTitlebar() {
  return <Titlebar />;
}

export const AutomationMainPanel = observer(function AutomationMainPanel({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { navigate } = useNavigate();
  const showConfirm = useShowModal('confirmActionModal');
  const autoApproveDefaults = useRuntimeAutoApproveDefaults();
  const { value: defaultRuntime } = useAppSettingsKey('defaultRuntime');
  const { value: automations, update, isLoading } = useAppSettingsKey('automations');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AutomationDraft>(() => makeDraft(DEFAULT_PROVIDER));
  const [runningId, setRunningId] = useState<string | null>(null);

  const defaultProvider = isValidRuntimeId(defaultRuntime) ? defaultRuntime : DEFAULT_PROVIDER;
  const items = useMemo(() => automations?.items ?? [], [automations?.items]);
  const currentItems = useMemo(() => items.filter((item) => item.status === 'active'), [items]);
  const pausedItems = useMemo(() => items.filter((item) => item.status === 'paused'), [items]);
  const editorOpen = editingId !== null;
  const canSave =
    draft.title.trim().length > 0 &&
    draft.workspaceName.trim().length > 0 &&
    draft.prompt.trim().length > 0;

  const persist = useCallback(
    (nextItems: AutomationEntry[]) => {
      update({ items: nextItems });
    },
    [update]
  );

  const openCreate = () => {
    setEditingId('new');
    setDraft(makeDraft(defaultProvider));
  };

  const openEdit = (entry: AutomationEntry) => {
    setEditingId(entry.id);
    setDraft(draftFromEntry(entry));
  };

  const closeEditor = () => {
    setEditingId(null);
    setDraft(makeDraft(defaultProvider));
  };

  const handleSave = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave) return;

    const existing =
      editingId && editingId !== 'new' ? items.find((item) => item.id === editingId) : undefined;
    const nextEntry = entryFromDraft(draft, existing);
    const nextItems = existing
      ? items.map((item) => (item.id === existing.id ? nextEntry : item))
      : [nextEntry, ...items];

    persist(nextItems);
    closeEditor();
  };

  const updateEntry = (entry: AutomationEntry, patch: Partial<AutomationEntry>) => {
    const now = new Date().toISOString();
    persist(
      items.map((item) =>
        item.id === entry.id ? { ...item, ...patch, updatedAt: patch.updatedAt ?? now } : item
      )
    );
  };

  const handleDelete = (entry: AutomationEntry) => {
    showConfirm({
      title: t('automation.delete.title'),
      description: t('automation.delete.description', { name: entry.title }),
      confirmLabel: t('automation.delete.confirmLabel'),
      onSuccess: () => {
        persist(items.filter((item) => item.id !== entry.id));
        if (editingId === entry.id) closeEditor();
      },
    });
  };

  const handleRun = async (entry: AutomationEntry) => {
    if (runningId) return;
    setRunningId(entry.id);
    try {
      const projectManager = getProjectManagerStore();
      await projectManager.mountProject(INTERNAL_PROJECT_ID).catch(() => {});
      const internalProject = asMounted(projectManager.projects.get(INTERNAL_PROJECT_ID));
      if (!internalProject) {
        throw new Error('Internal project not available');
      }
      const existingNames = Array.from(
        internalProject.taskManager.tasks.values(),
        (t) => t.data.name
      );
      const taskName = ensureUniqueTaskSlug(entry.title, existingNames);
      const taskId = crypto.randomUUID();
      const conversationId = crypto.randomUUID();
      await internalProject.taskManager.createTask({
        id: taskId,
        projectId: INTERNAL_PROJECT_ID,
        name: taskName,
        sourceBranch: { type: 'local', branch: 'main' },
        strategy: { kind: 'no-worktree' },
        initialConversation: {
          id: conversationId,
          projectId: INTERNAL_PROJECT_ID,
          taskId,
          runtime: entry.runtime,
          title: initialConversationTitle(entry.runtime, entry.prompt, []),
          initialPrompt: entry.prompt,
          autoApprove: autoApproveDefaults.getDefault(entry.runtime),
        },
      });
      updateEntry(entry, { lastRunAt: new Date().toISOString() });
      navigate('task', { projectId: INTERNAL_PROJECT_ID, taskId });
    } catch (error) {
      toast({
        title: t('automation.runFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setRunningId(null);
    }
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
        <div className={cn('flex items-start gap-4', embedded ? 'justify-end' : 'justify-between')}>
          {!embedded && (
            <h1 className="text-4xl font-normal tracking-normal">{t('automation.title')}</h1>
          )}
          <Button type="button" variant="outline" size="sm" onClick={openCreate}>
            <Plus className="size-4" />
            {t('automation.new')}
          </Button>
        </div>

        {editorOpen && (
          <AutomationEditor
            draft={draft}
            setDraft={setDraft}
            isEditing={editingId !== 'new'}
            canSave={canSave}
            onCancel={closeEditor}
            onSave={handleSave}
          />
        )}

        <div className={cn(embedded ? 'mt-8 space-y-10' : 'mt-16 space-y-16')}>
          <AutomationSection
            title={t('automation.current')}
            emptyLabel={t('automation.emptyCurrent')}
            items={currentItems}
            runningId={runningId}
            onEdit={openEdit}
            onDelete={handleDelete}
            onRun={handleRun}
            onToggle={(entry) => updateEntry(entry, { status: 'paused' })}
          />
          <AutomationSection
            title={t('automation.paused')}
            emptyLabel={t('automation.emptyPaused')}
            items={pausedItems}
            runningId={runningId}
            onEdit={openEdit}
            onDelete={handleDelete}
            onRun={handleRun}
            onToggle={(entry) => updateEntry(entry, { status: 'active' })}
          />
        </div>
      </div>
    </div>
  );
});

function AutomationEditor({
  draft,
  setDraft,
  isEditing,
  canSave,
  onCancel,
  onSave,
}: {
  draft: AutomationDraft;
  setDraft: React.Dispatch<React.SetStateAction<AutomationDraft>>;
  isEditing: boolean;
  canSave: boolean;
  onCancel: () => void;
  onSave: (event: React.FormEvent) => void;
}) {
  const { t } = useTranslation();
  const runtimes = useMemo(() => RUNTIMES.filter((runtime) => runtime.detectable !== false), []);
  const runtimeName = runtimes.find((runtime) => runtime.id === draft.runtime)?.name;

  return (
    <form
      onSubmit={onSave}
      className="mt-10 grid gap-4 rounded-lg border border-border bg-background-secondary p-4"
    >
      <div className="grid gap-4 @3xl:grid-cols-[minmax(0,1fr)_14rem]">
        <label className="grid gap-1.5">
          <span className="text-xs text-foreground-muted">{t('automation.form.title')}</span>
          <Input
            value={draft.title}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            placeholder={t('automation.form.titlePlaceholder')}
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs text-foreground-muted">{t('automation.form.schedule')}</span>
          <Input
            value={draft.scheduleLabel}
            onChange={(event) =>
              setDraft((current) => ({ ...current, scheduleLabel: event.target.value }))
            }
            placeholder={t('automation.form.schedulePlaceholder')}
          />
        </label>
      </div>
      <div className="grid gap-4 @3xl:grid-cols-[minmax(0,1fr)_14rem_10rem]">
        <label className="grid gap-1.5">
          <span className="text-xs text-foreground-muted">{t('automation.form.workspace')}</span>
          <Input
            value={draft.workspaceName}
            onChange={(event) =>
              setDraft((current) => ({ ...current, workspaceName: event.target.value }))
            }
            placeholder={t('automation.form.workspacePlaceholder')}
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs text-foreground-muted">{t('automation.form.agent')}</span>
          <Select
            value={draft.runtime}
            onValueChange={(value) => {
              if (!isValidRuntimeId(value)) return;
              setDraft((current) => ({ ...current, runtime: value }));
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue>{runtimeName ?? draft.runtime}</SelectValue>
            </SelectTrigger>
            <SelectContent align="start" alignItemWithTrigger={false}>
              {runtimes.map((runtime) => (
                <SelectItem key={runtime.id} value={runtime.id}>
                  {runtime.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs text-foreground-muted">{t('automation.form.status')}</span>
          <Select
            value={draft.status}
            onValueChange={(value) => {
              if (value !== 'active' && value !== 'paused') return;
              setDraft((current) => ({ ...current, status: value }));
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {draft.status === 'active'
                  ? t('automation.status.active')
                  : t('automation.status.paused')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="start" alignItemWithTrigger={false}>
              <SelectItem value="active">{t('automation.status.active')}</SelectItem>
              <SelectItem value="paused">{t('automation.status.paused')}</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>
      <label className="grid gap-1.5">
        <span className="text-xs text-foreground-muted">{t('automation.form.prompt')}</span>
        <Textarea
          value={draft.prompt}
          onChange={(event) => setDraft((current) => ({ ...current, prompt: event.target.value }))}
          placeholder={t('automation.form.promptPlaceholder')}
          className="min-h-28 resize-y"
        />
      </label>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <X className="size-4" />
          {t('common.cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={!canSave}>
          <Save className="size-4" />
          {isEditing ? t('common.save') : t('common.create')}
        </Button>
      </div>
    </form>
  );
}

function AutomationSection({
  title,
  emptyLabel,
  items,
  runningId,
  onEdit,
  onDelete,
  onRun,
  onToggle,
}: {
  title: string;
  emptyLabel: string;
  items: AutomationEntry[];
  runningId: string | null;
  onEdit: (entry: AutomationEntry) => void;
  onDelete: (entry: AutomationEntry) => void;
  onRun: (entry: AutomationEntry) => void;
  onToggle: (entry: AutomationEntry) => void;
}) {
  return (
    <section>
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-5 border-t border-border">
        {items.length === 0 ? (
          <div className="border-b border-border py-8 text-sm text-foreground-muted">
            {emptyLabel}
          </div>
        ) : (
          items.map((entry) => (
            <AutomationRow
              key={entry.id}
              entry={entry}
              isRunning={runningId === entry.id}
              onEdit={onEdit}
              onDelete={onDelete}
              onRun={onRun}
              onToggle={onToggle}
            />
          ))
        )}
      </div>
    </section>
  );
}

const AutomationRow = observer(function AutomationRow({
  entry,
  isRunning,
  onEdit,
  onDelete,
  onRun,
  onToggle,
}: {
  entry: AutomationEntry;
  isRunning: boolean;
  onEdit: (entry: AutomationEntry) => void;
  onDelete: (entry: AutomationEntry) => void;
  onRun: (entry: AutomationEntry) => void;
  onToggle: (entry: AutomationEntry) => void;
}) {
  const { t } = useTranslation();
  const runtime = RUNTIMES.find((item) => item.id === entry.runtime);
  const detected = appState.dependencies.agentStatuses[entry.runtime]?.status === 'available';
  const rightLabel =
    entry.status === 'active'
      ? entry.scheduleLabel || t('automation.scheduleManual')
      : t('automation.pausedStatus');

  return (
    <div className="group grid min-h-[72px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-border py-3">
      <button
        type="button"
        onClick={() => onEdit(entry)}
        className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] items-center text-left"
      >
        <span className="flex items-center justify-start">
          {entry.status === 'active' ? (
            <Circle className="size-5 text-foreground-muted" />
          ) : (
            <PauseCircle className="size-5 text-foreground-muted" />
          )}
        </span>
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-lg font-normal text-foreground">{entry.title}</span>
          <span className="truncate text-lg text-foreground-muted">{entry.workspaceName}</span>
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]',
              detected ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground-passive'
            )}
          >
            <Bot className="size-3" />
            {runtime?.name ?? entry.runtime}
          </span>
        </span>
      </button>
      <div className="flex items-center gap-3">
        <span className="min-w-24 text-right text-lg text-foreground-muted">{rightLabel}</span>
        <TooltipProvider delay={150}>
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <IconTooltip label={t('automation.actions.run')}>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => void onRun(entry)}
                disabled={isRunning}
                aria-label={t('automation.actions.run')}
              >
                {isRunning ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Play className="size-3" />
                )}
              </Button>
            </IconTooltip>
            <IconTooltip label={t('automation.actions.edit')}>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => onEdit(entry)}
                aria-label={t('automation.actions.edit')}
              >
                <Pencil className="size-3" />
              </Button>
            </IconTooltip>
            <IconTooltip
              label={
                entry.status === 'active'
                  ? t('automation.actions.pause')
                  : t('automation.actions.resume')
              }
            >
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => onToggle(entry)}
                aria-label={
                  entry.status === 'active'
                    ? t('automation.actions.pause')
                    : t('automation.actions.resume')
                }
              >
                <PauseCircle className="size-3" />
              </Button>
            </IconTooltip>
            <IconTooltip label={t('automation.actions.delete')}>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => onDelete(entry)}
                aria-label={t('automation.actions.delete')}
              >
                <Trash2 className="size-3" />
              </Button>
            </IconTooltip>
          </div>
        </TooltipProvider>
      </div>
    </div>
  );
});

function IconTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger className="h-auto" render={<span className="inline-flex" />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export const automationView = {
  TitlebarSlot: AutomationTitlebar,
  MainPanel: AutomationMainPanel,
};
