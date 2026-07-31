import {
  Activity,
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Clock3,
  Folder,
  History,
  Loader2,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Save,
  Settings2,
  Trash2,
  Workflow,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  Automation,
  AutomationCreateInput,
  AutomationRun,
  AutomationTriggerKind,
} from '@shared/automation';
import { INTERNAL_PROJECT_ID } from '@shared/projects';
import { isValidRuntimeId, RUNTIMES, type RuntimeId } from '@shared/runtime-registry';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { Input } from '@renderer/lib/ui/input';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Switch } from '@renderer/lib/ui/switch';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';
import {
  buildFriendlyCron,
  DEFAULT_AUTOMATION_CRON,
  parseFriendlySchedule,
} from './automation-schedule';
import {
  useAutomationHistory,
  useAutomations,
  useCreateAutomation,
  useDeleteAutomation,
  useRunAutomation,
  useUpdateAutomation,
} from './use-automations';

type AutomationDraft = {
  title: string;
  workspaceName: string;
  runtime: RuntimeId;
  prompt: string;
  status: Automation['status'];
  triggerKind: AutomationTriggerKind;
  cronExpr: string;
};

type AutomationFilter = 'active' | 'paused' | 'all';

const DEFAULT_PROVIDER: RuntimeId = 'codex';

function makeDraft(runtime: RuntimeId): AutomationDraft {
  return {
    title: '',
    workspaceName: 'Yoda',
    runtime,
    prompt: '',
    status: 'active',
    triggerKind: 'manual',
    cronExpr: '',
  };
}

function draftFromEntry(entry: Automation): AutomationDraft {
  return {
    title: entry.title,
    workspaceName: entry.workspaceName,
    runtime: entry.runtime,
    prompt: entry.prompt,
    status: entry.status,
    triggerKind: entry.triggerKind,
    cronExpr: entry.cronExpr ?? '',
  };
}

function draftToInput(draft: AutomationDraft): AutomationCreateInput {
  return {
    title: draft.title.trim(),
    workspaceName: draft.workspaceName.trim(),
    runtime: draft.runtime,
    prompt: draft.prompt.trim(),
    status: draft.status,
    triggerKind: draft.triggerKind,
    cronExpr: draft.triggerKind === 'cron' ? draft.cronExpr.trim() || null : null,
    scheduleLabel: '',
    timezone: null,
    projectId: null,
  };
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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
  const { value: defaultRuntime } = useAppSettingsKey('defaultRuntime');
  const { data: automationsData, isLoading } = useAutomations();
  const { data: historyData } = useAutomationHistory();
  const createAutomation = useCreateAutomation();
  const updateAutomation = useUpdateAutomation();
  const deleteAutomation = useDeleteAutomation();
  const runAutomation = useRunAutomation();
  const editorRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<AutomationFilter>('active');
  const [draft, setDraft] = useState<AutomationDraft>(() => makeDraft(DEFAULT_PROVIDER));

  const defaultProvider = isValidRuntimeId(defaultRuntime) ? defaultRuntime : DEFAULT_PROVIDER;
  const items = useMemo(() => automationsData ?? [], [automationsData]);
  const history = useMemo(() => historyData ?? [], [historyData]);
  const activeItems = useMemo(() => items.filter((item) => item.status === 'active'), [items]);
  const pausedItems = useMemo(() => items.filter((item) => item.status === 'paused'), [items]);
  const visibleItems = useMemo(() => {
    if (filter === 'active') return activeItems;
    if (filter === 'paused') return pausedItems;
    return items;
  }, [activeItems, filter, items, pausedItems]);
  const automationById = useMemo(
    () => new Map(items.map((item) => [item.id, item] as const)),
    [items]
  );
  const latestRuns = useMemo(() => {
    const map = new Map<string, AutomationRun>();
    for (const run of history) {
      if (!map.has(run.automationId)) map.set(run.automationId, run);
    }
    return map;
  }, [history]);
  const nextAutomation = useMemo(
    () =>
      activeItems
        .filter((entry) => entry.nextRunAt)
        .sort(
          (left, right) =>
            new Date(left.nextRunAt ?? 0).getTime() - new Date(right.nextRunAt ?? 0).getTime()
        )[0],
    [activeItems]
  );
  const settledRuns = useMemo(
    () => history.filter((run) => run.status === 'success' || run.status === 'failed').slice(0, 10),
    [history]
  );
  const successfulRuns = settledRuns.filter((run) => run.status === 'success').length;
  const runningId = runAutomation.isPending ? (runAutomation.variables ?? null) : null;
  const updatingId = updateAutomation.isPending ? (updateAutomation.variables?.id ?? null) : null;
  const editorOpen = editingId !== null;
  const isSaving =
    createAutomation.isPending ||
    (updateAutomation.isPending && updateAutomation.variables?.id === editingId);
  const canSave =
    draft.title.trim().length > 0 &&
    draft.workspaceName.trim().length > 0 &&
    draft.prompt.trim().length > 0 &&
    (draft.triggerKind !== 'cron' || draft.cronExpr.trim().length > 0);

  const revealEditor = () => {
    requestAnimationFrame(() => editorRef.current?.scrollIntoView({ block: 'start' }));
  };

  const openCreate = () => {
    setEditingId('new');
    setDraft(makeDraft(defaultProvider));
    revealEditor();
  };

  const openEdit = (entry: Automation) => {
    setEditingId(entry.id);
    setDraft(draftFromEntry(entry));
    revealEditor();
  };

  const closeEditor = () => {
    setEditingId(null);
    setDraft(makeDraft(defaultProvider));
  };

  const saveError = (error: unknown) =>
    toast({
      title: t('automation.saveFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive',
    });

  const updateError = (error: unknown) =>
    toast({
      title: t('automation.updateFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive',
    });

  const handleSave = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave || isSaving) return;

    const input = draftToInput(draft);
    if (editingId && editingId !== 'new') {
      updateAutomation.mutate(
        { id: editingId, patch: input },
        { onSuccess: closeEditor, onError: saveError }
      );
    } else {
      createAutomation.mutate(input, { onSuccess: closeEditor, onError: saveError });
    }
  };

  const handleDelete = (entry: Automation) => {
    showConfirm({
      title: t('automation.delete.title'),
      description: t('automation.delete.description', { name: entry.title }),
      confirmLabel: t('automation.delete.confirmLabel'),
      onSuccess: () => {
        deleteAutomation.mutate(entry.id);
        if (editingId === entry.id) closeEditor();
      },
    });
  };

  const handleRun = (entry: Automation) => {
    runAutomation.mutate(entry.id, {
      onError: (error) =>
        toast({
          title: t('automation.runFailed'),
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        }),
    });
  };

  const handleToggle = (entry: Automation) => {
    updateAutomation.mutate(
      {
        id: entry.id,
        patch: { status: entry.status === 'active' ? 'paused' : 'active' },
      },
      { onError: updateError }
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
        className={cn(
          'mx-auto flex w-full max-w-[1180px] flex-col',
          embedded ? 'pb-4' : 'px-6 py-8 @3xl:px-10 @3xl:py-10'
        )}
      >
        <header
          className={cn(
            'flex flex-wrap items-start justify-between gap-5',
            embedded && 'justify-end'
          )}
        >
          {!embedded && (
            <div className="max-w-2xl">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium tracking-wide text-foreground-muted">
                <Workflow className="size-3.5" />
                {t('automation.eyebrow')}
              </div>
              <h1 className="text-3xl font-semibold tracking-tight">{t('automation.title')}</h1>
              <p className="mt-2 text-sm leading-6 text-foreground-muted">
                {t('automation.subtitle')}
              </p>
            </div>
          )}
          <Button type="button" onClick={openCreate}>
            <Plus className="size-4" />
            {t('automation.new')}
          </Button>
        </header>

        <AutomationOverview
          className={cn(embedded ? 'mt-5' : 'mt-8')}
          activeCount={activeItems.length}
          scheduledCount={activeItems.filter((entry) => entry.triggerKind === 'cron').length}
          nextAutomation={nextAutomation}
          successfulRuns={successfulRuns}
          settledRunCount={settledRuns.length}
        />

        {editorOpen && (
          <div ref={editorRef} className="scroll-mt-4">
            <AutomationEditor
              draft={draft}
              setDraft={setDraft}
              isEditing={editingId !== 'new'}
              canSave={canSave}
              isSaving={isSaving}
              onCancel={closeEditor}
              onSave={handleSave}
            />
          </div>
        )}

        <div className="mt-8 grid items-start gap-6 @5xl:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">{t('automation.yourAutomations')}</h2>
                <p className="mt-0.5 text-xs text-foreground-muted">
                  {t('automation.yourAutomationsDescription')}
                </p>
              </div>
              <AutomationFilterControl
                value={filter}
                activeCount={activeItems.length}
                pausedCount={pausedItems.length}
                totalCount={items.length}
                onChange={setFilter}
              />
            </div>

            <div className="mt-4 space-y-3">
              {visibleItems.length === 0 ? (
                <AutomationEmptyState
                  filter={filter}
                  hasAutomations={items.length > 0}
                  onCreate={openCreate}
                />
              ) : (
                visibleItems.map((entry) => (
                  <AutomationCard
                    key={entry.id}
                    entry={entry}
                    isRunning={runningId === entry.id}
                    isUpdating={updatingId === entry.id}
                    lastRun={latestRuns.get(entry.id)}
                    onEdit={openEdit}
                    onDelete={handleDelete}
                    onRun={handleRun}
                    onToggle={handleToggle}
                  />
                ))
              )}
            </div>
          </section>

          <RecentRuns
            runs={history.slice(0, 6)}
            automationById={automationById}
            onOpenTask={(taskId) => navigate('task', { projectId: INTERNAL_PROJECT_ID, taskId })}
          />
        </div>
      </div>
    </div>
  );
});

function AutomationOverview({
  className,
  activeCount,
  scheduledCount,
  nextAutomation,
  successfulRuns,
  settledRunCount,
}: {
  className?: string;
  activeCount: number;
  scheduledCount: number;
  nextAutomation: Automation | undefined;
  successfulRuns: number;
  settledRunCount: number;
}) {
  const { t } = useTranslation();

  return (
    <section
      aria-label={t('automation.overview.label')}
      className={cn(
        'grid overflow-hidden rounded-xl border border-border/80 bg-background-secondary divide-y divide-border/70 @3xl:grid-cols-3 @3xl:divide-x @3xl:divide-y-0',
        className
      )}
    >
      <OverviewMetric
        icon={Activity}
        label={t('automation.overview.active')}
        value={String(activeCount)}
        detail={t('automation.overview.scheduledCount', { count: scheduledCount })}
        tone="active"
      />
      <OverviewMetric
        icon={CalendarClock}
        label={t('automation.overview.nextRun')}
        value={nextAutomation?.title ?? t('automation.overview.noScheduledRun')}
        detail={
          nextAutomation?.nextRunAt
            ? formatTime(nextAutomation.nextRunAt)
            : t('automation.overview.createScheduleHint')
        }
      />
      <OverviewMetric
        icon={CheckCircle2}
        label={t('automation.overview.recentHealth')}
        value={
          settledRunCount > 0
            ? t('automation.overview.successRatio', {
                success: successfulRuns,
                total: settledRunCount,
              })
            : t('automation.overview.noRuns')
        }
        detail={
          settledRunCount > 0
            ? t('automation.overview.latestRuns', { count: settledRunCount })
            : t('automation.overview.runHint')
        }
        tone={settledRunCount > 0 && successfulRuns === settledRunCount ? 'success' : 'neutral'}
      />
    </section>
  );
}

function OverviewMetric({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone?: 'active' | 'success' | 'neutral';
}) {
  return (
    <div className="flex min-w-0 items-center gap-3.5 px-4 py-4">
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg border',
          tone === 'active' && 'border-blue-500/15 bg-blue-500/10 text-blue-600 dark:text-blue-400',
          tone === 'success' &&
            'border-emerald-500/15 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
          tone === 'neutral' && 'border-border bg-background text-foreground-muted'
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-medium text-foreground-muted">{label}</span>
        <strong className="mt-0.5 block truncate text-sm font-semibold text-foreground">
          {value}
        </strong>
        <span className="mt-0.5 block truncate text-[11px] text-foreground-passive">{detail}</span>
      </span>
    </div>
  );
}

function AutomationFilterControl({
  value,
  activeCount,
  pausedCount,
  totalCount,
  onChange,
}: {
  value: AutomationFilter;
  activeCount: number;
  pausedCount: number;
  totalCount: number;
  onChange: (value: AutomationFilter) => void;
}) {
  const { t } = useTranslation();
  const filters: Array<{ id: AutomationFilter; label: string; count: number }> = [
    { id: 'active', label: t('automation.filters.active'), count: activeCount },
    { id: 'paused', label: t('automation.filters.paused'), count: pausedCount },
    { id: 'all', label: t('automation.filters.all'), count: totalCount },
  ];

  return (
    <div
      role="group"
      aria-label={t('automation.filters.label')}
      className="flex items-center rounded-lg border border-border bg-background-secondary p-0.5"
    >
      {filters.map((filter) => (
        <button
          key={filter.id}
          type="button"
          aria-pressed={value === filter.id}
          onClick={() => onChange(filter.id)}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
            value === filter.id
              ? 'bg-background text-foreground shadow-xs'
              : 'text-foreground-muted hover:text-foreground'
          )}
        >
          {filter.label}
          <span
            className={cn(
              'text-[10px]',
              value === filter.id ? 'text-foreground-muted' : 'text-foreground-passive'
            )}
          >
            {filter.count}
          </span>
        </button>
      ))}
    </div>
  );
}

function AutomationEmptyState({
  filter,
  hasAutomations,
  onCreate,
}: {
  filter: AutomationFilter;
  hasAutomations: boolean;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  const isFirstAutomation = !hasAutomations;

  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background-secondary/50 px-6 text-center">
      <span className="flex size-10 items-center justify-center rounded-xl border border-border bg-background text-foreground-muted shadow-xs">
        <Workflow className="size-4" />
      </span>
      <h3 className="mt-3 text-sm font-semibold">
        {isFirstAutomation
          ? t('automation.empty.title')
          : filter === 'paused'
            ? t('automation.empty.pausedTitle')
            : t('automation.empty.activeTitle')}
      </h3>
      <p className="mt-1 max-w-sm text-xs leading-5 text-foreground-muted">
        {isFirstAutomation
          ? t('automation.empty.description')
          : filter === 'paused'
            ? t('automation.empty.pausedDescription')
            : t('automation.empty.activeDescription')}
      </p>
      {isFirstAutomation && (
        <Button type="button" size="sm" className="mt-4" onClick={onCreate}>
          <Plus className="size-3.5" />
          {t('automation.empty.action')}
        </Button>
      )}
    </div>
  );
}

const RUN_STATUS_STYLES: Record<AutomationRun['status'], { icon: LucideIcon; className: string }> =
  {
    running: {
      icon: Loader2,
      className: 'border-amber-500/15 bg-amber-500/10 text-amber-600 dark:text-amber-400',
    },
    success: {
      icon: CheckCircle2,
      className: 'border-emerald-500/15 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    },
    failed: {
      icon: XCircle,
      className: 'border-red-500/15 bg-red-500/10 text-red-600 dark:text-red-400',
    },
    skipped: {
      icon: CircleDashed,
      className: 'border-border bg-background-2 text-foreground-muted',
    },
  };

const AutomationCard = observer(function AutomationCard({
  entry,
  isRunning,
  isUpdating,
  lastRun,
  onEdit,
  onDelete,
  onRun,
  onToggle,
}: {
  entry: Automation;
  isRunning: boolean;
  isUpdating: boolean;
  lastRun: AutomationRun | undefined;
  onEdit: (entry: Automation) => void;
  onDelete: (entry: Automation) => void;
  onRun: (entry: Automation) => void;
  onToggle: (entry: Automation) => void;
}) {
  const { t } = useTranslation();
  const runtime = RUNTIMES.find((item) => item.id === entry.runtime);
  const detected = appState.dependencies.agentStatuses[entry.runtime]?.status === 'available';
  const scheduleLabel =
    entry.triggerKind === 'cron'
      ? entry.nextRunAt
        ? t('automation.nextRunLabel', { time: formatTime(entry.nextRunAt) })
        : t('automation.schedule.pending')
      : t('automation.schedule.manual');
  const runStyle = lastRun ? RUN_STATUS_STYLES[lastRun.status] : null;
  const RunStatusIcon = runStyle?.icon;

  return (
    <article
      className={cn(
        'group overflow-hidden rounded-xl border border-border/80 bg-background-secondary transition-[border-color,box-shadow,opacity] hover:border-border-strong hover:shadow-sm',
        entry.status === 'paused' && 'opacity-80'
      )}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border',
              entry.status === 'active'
                ? 'border-blue-500/15 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                : 'border-border bg-background text-foreground-muted'
            )}
          >
            {entry.status === 'active' ? (
              <Workflow className="size-4" />
            ) : (
              <Pause className="size-4" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="min-w-0 truncate text-[15px] font-semibold">{entry.title}</h3>
              <Badge
                variant="secondary"
                className={cn(
                  entry.status === 'active'
                    ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                    : 'text-foreground-muted'
                )}
              >
                {entry.status === 'active'
                  ? t('automation.status.active')
                  : t('automation.status.paused')}
              </Badge>
              {lastRun && runStyle && RunStatusIcon && (
                <Badge variant="outline" className={runStyle.className}>
                  <RunStatusIcon
                    className={cn('size-3', lastRun.status === 'running' && 'animate-spin')}
                  />
                  {t(`automation.runStatus.${lastRun.status}`)}
                </Badge>
              )}
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-foreground-muted">
              {entry.prompt}
            </p>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t('automation.actions.more', { name: entry.title })}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-muted outline-none transition-colors hover:bg-background-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => onEdit(entry)}>
                <Pencil className="size-4" />
                {t('automation.actions.edit')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onToggle(entry)}>
                {entry.status === 'active' ? (
                  <Pause className="size-4" />
                ) : (
                  <Play className="size-4" />
                )}
                {entry.status === 'active'
                  ? t('automation.actions.pause')
                  : t('automation.actions.resume')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => onDelete(entry)}>
                <Trash2 className="size-4" />
                {t('automation.actions.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mt-4 grid gap-2 @2xl:grid-cols-2">
          <AutomationMeta
            icon={CalendarClock}
            label={t('automation.card.schedule')}
            value={scheduleLabel}
            detail={entry.triggerKind === 'cron' ? (entry.cronExpr ?? undefined) : undefined}
          />
          <AutomationMeta
            icon={Folder}
            label={t('automation.card.workspace')}
            value={entry.workspaceName}
          />
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 bg-background/55 px-4 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-foreground-muted">
          <span
            className={cn(
              'inline-flex items-center gap-1',
              detected ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground-muted'
            )}
          >
            <Bot className="size-3" />
            {runtime?.name ?? entry.runtime}
          </span>
          {lastRun ? (
            <span className="inline-flex items-center gap-1">
              <History className="size-3" />
              {t('automation.card.lastRun')}{' '}
              <RelativeTime value={lastRun.startedAt} className="text-foreground-muted" />
            </span>
          ) : (
            <span>{t('automation.card.neverRun')}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-2 text-xs text-foreground-muted">
            {entry.status === 'active'
              ? t('automation.actions.enabled')
              : t('automation.actions.disabled')}
            <Switch
              size="sm"
              checked={entry.status === 'active'}
              disabled={isUpdating}
              onCheckedChange={() => onToggle(entry)}
              aria-label={
                entry.status === 'active'
                  ? t('automation.actions.pause')
                  : t('automation.actions.resume')
              }
            />
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onRun(entry)}
            disabled={isRunning}
          >
            {isRunning ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5" />
            )}
            {isRunning ? t('automation.actions.running') : t('automation.actions.runNow')}
          </Button>
        </div>
      </footer>
    </article>
  );
});

function AutomationMeta({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-lg border border-border/60 bg-background px-3 py-2">
      <Icon className="size-3.5 shrink-0 text-foreground-muted" />
      <span className="min-w-0">
        <span className="block text-[10px] font-medium text-foreground-passive">{label}</span>
        <span className="flex min-w-0 items-baseline gap-1.5">
          <strong className="truncate text-xs font-medium text-foreground">{value}</strong>
          {detail && <code className="shrink-0 text-[9px] text-foreground-passive">{detail}</code>}
        </span>
      </span>
    </div>
  );
}

function RecentRuns({
  runs,
  automationById,
  onOpenTask,
}: {
  runs: AutomationRun[];
  automationById: Map<string, Automation>;
  onOpenTask: (taskId: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <aside className="overflow-hidden rounded-xl border border-border/80 bg-background-secondary">
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{t('automation.recentRuns.title')}</h2>
          <p className="mt-0.5 text-[11px] text-foreground-muted">
            {t('automation.recentRuns.description')}
          </p>
        </div>
        <History className="size-4 text-foreground-muted" />
      </div>
      {runs.length === 0 ? (
        <div className="flex min-h-40 flex-col items-center justify-center px-5 text-center">
          <Clock3 className="size-5 text-foreground-passive" />
          <p className="mt-2 text-xs font-medium">{t('automation.recentRuns.empty')}</p>
          <p className="mt-1 text-[11px] leading-4 text-foreground-muted">
            {t('automation.recentRuns.emptyDescription')}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/60">
          {runs.map((run) => (
            <RecentRunRow
              key={run.id}
              run={run}
              automation={automationById.get(run.automationId)}
              onOpenTask={onOpenTask}
            />
          ))}
        </div>
      )}
    </aside>
  );
}

function RecentRunRow({
  run,
  automation,
  onOpenTask,
}: {
  run: AutomationRun;
  automation: Automation | undefined;
  onOpenTask: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const style = RUN_STATUS_STYLES[run.status];
  const StatusIcon = style.icon;
  const content = (
    <>
      <span
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-full',
          style.className
        )}
      >
        <StatusIcon className={cn('size-3.5', run.status === 'running' && 'animate-spin')} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">
          {automation?.title ?? t('automation.recentRuns.deletedAutomation')}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-foreground-muted">
          {t(`automation.runStatus.${run.status}`)}
          <span aria-hidden="true">·</span>
          <RelativeTime value={run.startedAt} />
        </span>
      </span>
      {run.taskId && <ChevronRight className="size-3.5 shrink-0 text-foreground-passive" />}
    </>
  );

  if (!run.taskId) {
    return <div className="flex items-center gap-2.5 px-4 py-3">{content}</div>;
  }

  return (
    <button
      type="button"
      className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-background-1 focus-visible:bg-background-1 focus-visible:outline-none"
      onClick={() => onOpenTask(run.taskId as string)}
    >
      {content}
    </button>
  );
}

function AutomationEditor({
  draft,
  setDraft,
  isEditing,
  canSave,
  isSaving,
  onCancel,
  onSave,
}: {
  draft: AutomationDraft;
  setDraft: React.Dispatch<React.SetStateAction<AutomationDraft>>;
  isEditing: boolean;
  canSave: boolean;
  isSaving: boolean;
  onCancel: () => void;
  onSave: (event: React.FormEvent) => void;
}) {
  const { t } = useTranslation();
  const runtimes = useMemo(() => RUNTIMES.filter((runtime) => runtime.detectable !== false), []);
  const runtimeName = runtimes.find((runtime) => runtime.id === draft.runtime)?.name;
  const friendlySchedule = parseFriendlySchedule(draft.cronExpr);
  const scheduleKind = friendlySchedule?.kind ?? 'custom';

  return (
    <form
      onSubmit={onSave}
      className="mt-6 overflow-hidden rounded-xl border border-border bg-background-secondary shadow-sm"
    >
      <div className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-blue-500/15 bg-blue-500/10 text-blue-600 dark:text-blue-400">
            <Settings2 className="size-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">
              {isEditing ? t('automation.editor.editTitle') : t('automation.editor.createTitle')}
            </h2>
            <p className="mt-1 text-xs text-foreground-muted">
              {t('automation.editor.description')}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onCancel}
          disabled={isSaving}
          aria-label={t('common.close')}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      <div className="grid gap-6 p-5 @4xl:grid-cols-[minmax(0,1.35fr)_minmax(17rem,0.85fr)]">
        <div className="grid content-start gap-4">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">
              {t('automation.form.title')}
            </span>
            <Input
              autoFocus
              value={draft.title}
              onChange={(event) =>
                setDraft((current) => ({ ...current, title: event.target.value }))
              }
              placeholder={t('automation.form.titlePlaceholder')}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">
              {t('automation.form.prompt')}
            </span>
            <Textarea
              value={draft.prompt}
              onChange={(event) =>
                setDraft((current) => ({ ...current, prompt: event.target.value }))
              }
              placeholder={t('automation.form.promptPlaceholder')}
              className="min-h-40 resize-y"
            />
            <span className="text-[11px] leading-4 text-foreground-passive">
              {t('automation.form.promptHint')}
            </span>
          </label>
        </div>

        <div className="grid content-start gap-4 rounded-lg border border-border/70 bg-background p-4">
          <div>
            <h3 className="text-xs font-semibold">{t('automation.editor.executionTitle')}</h3>
            <p className="mt-1 text-[11px] leading-4 text-foreground-muted">
              {t('automation.editor.executionDescription')}
            </p>
          </div>

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
            <span className="text-xs text-foreground-muted">{t('automation.form.trigger')}</span>
            <Select
              value={draft.triggerKind}
              onValueChange={(value) => {
                if (value !== 'manual' && value !== 'cron') return;
                setDraft((current) => ({
                  ...current,
                  triggerKind: value,
                  cronExpr:
                    value === 'cron' && !current.cronExpr
                      ? DEFAULT_AUTOMATION_CRON
                      : current.cronExpr,
                }));
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {draft.triggerKind === 'cron'
                    ? t('automation.trigger.cron')
                    : t('automation.trigger.manual')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false}>
                <SelectItem value="manual">{t('automation.trigger.manual')}</SelectItem>
                <SelectItem value="cron">{t('automation.trigger.cron')}</SelectItem>
              </SelectContent>
            </Select>
          </label>

          {draft.triggerKind === 'cron' ? (
            <div className="grid gap-3 rounded-lg border border-border/60 bg-background-secondary p-3">
              <label className="grid gap-1.5">
                <span className="text-xs text-foreground-muted">
                  {t('automation.form.scheduleFrequency')}
                </span>
                <Select
                  value={scheduleKind}
                  onValueChange={(value) => {
                    if (
                      value !== 'daily' &&
                      value !== 'weekdays' &&
                      value !== 'weekly' &&
                      value !== 'custom'
                    ) {
                      return;
                    }
                    setDraft((current) => ({
                      ...current,
                      cronExpr:
                        value === 'custom'
                          ? ''
                          : buildFriendlyCron(
                              value,
                              friendlySchedule?.time ?? '09:00',
                              friendlySchedule?.weekday
                            ),
                    }));
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>{t(`automation.form.scheduleKinds.${scheduleKind}`)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start" alignItemWithTrigger={false}>
                    <SelectItem value="daily">
                      {t('automation.form.scheduleKinds.daily')}
                    </SelectItem>
                    <SelectItem value="weekdays">
                      {t('automation.form.scheduleKinds.weekdays')}
                    </SelectItem>
                    <SelectItem value="weekly">
                      {t('automation.form.scheduleKinds.weekly')}
                    </SelectItem>
                    <SelectItem value="custom">
                      {t('automation.form.scheduleKinds.custom')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </label>

              {friendlySchedule ? (
                <div className="grid gap-3 @xl:grid-cols-2">
                  {friendlySchedule.kind === 'weekly' && (
                    <label className="grid gap-1.5">
                      <span className="text-xs text-foreground-muted">
                        {t('automation.form.weekday')}
                      </span>
                      <Select
                        value={friendlySchedule.weekday}
                        onValueChange={(weekday) =>
                          setDraft((current) => ({
                            ...current,
                            cronExpr: buildFriendlyCron(
                              'weekly',
                              friendlySchedule.time,
                              weekday ?? '1'
                            ),
                          }))
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue>
                            {t(`automation.form.weekdays.${friendlySchedule.weekday}`)}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent align="start" alignItemWithTrigger={false}>
                          {['1', '2', '3', '4', '5', '6', '0'].map((weekday) => (
                            <SelectItem key={weekday} value={weekday}>
                              {t(`automation.form.weekdays.${weekday}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                  )}
                  <label
                    className={cn(
                      'grid gap-1.5',
                      friendlySchedule.kind !== 'weekly' && '@xl:col-span-2'
                    )}
                  >
                    <span className="text-xs text-foreground-muted">
                      {t('automation.form.runTime')}
                    </span>
                    <Input
                      type="time"
                      value={friendlySchedule.time}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          cronExpr: buildFriendlyCron(
                            friendlySchedule.kind,
                            event.target.value,
                            friendlySchedule.weekday
                          ),
                        }))
                      }
                    />
                  </label>
                </div>
              ) : (
                <label className="grid gap-1.5">
                  <span className="text-xs text-foreground-muted">{t('automation.form.cron')}</span>
                  <Input
                    value={draft.cronExpr}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, cronExpr: event.target.value }))
                    }
                    placeholder={t('automation.form.cronPlaceholder')}
                    className="font-mono"
                  />
                  <span className="text-[10px] leading-4 text-foreground-passive">
                    {t('automation.form.cronHint')}
                  </span>
                </label>
              )}

              <span className="inline-flex items-center gap-1.5 text-[10px] text-foreground-passive">
                <Clock3 className="size-3" />
                {t('automation.form.localTimezone')}
              </span>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-background-secondary px-3 py-2.5">
              <Play className="mt-0.5 size-3.5 shrink-0 text-foreground-muted" />
              <p className="text-[11px] leading-4 text-foreground-muted">
                {t('automation.form.manualHint')}
              </p>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
            <span>
              <span className="block text-xs font-medium">{t('automation.form.enabled')}</span>
              <span className="mt-0.5 block text-[10px] text-foreground-muted">
                {t('automation.form.enabledHint')}
              </span>
            </span>
            <Switch
              checked={draft.status === 'active'}
              onCheckedChange={(checked) =>
                setDraft((current) => ({
                  ...current,
                  status: checked ? 'active' : 'paused',
                }))
              }
              aria-label={t('automation.form.enabled')}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 bg-background/50 px-5 py-3">
        <p className="text-[11px] text-foreground-passive">
          {canSave ? t('automation.editor.ready') : t('automation.editor.requiredHint')}
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={isSaving}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" size="sm" disabled={!canSave || isSaving}>
            {isSaving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            {isSaving ? t('common.saving') : isEditing ? t('common.save') : t('common.create')}
          </Button>
        </div>
      </div>
    </form>
  );
}

export const automationView = {
  TitlebarSlot: AutomationTitlebar,
  MainPanel: AutomationMainPanel,
};
