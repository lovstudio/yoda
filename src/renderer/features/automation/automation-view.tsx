import {
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  ClipboardCopy,
  Clock3,
  Folder,
  History,
  Loader2,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RefreshCw,
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
import { openTaskTarget } from '@renderer/app/open-task-target';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { copyTextToClipboard, useToast } from '@renderer/lib/hooks/use-toast';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@renderer/lib/ui/collapsible';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import {
  AUTOMATION_SCHEDULE_PREVIEW_DAYS,
  buildAutomationSchedulePreview,
  buildFriendlyCron,
  DEFAULT_AUTOMATION_CRON,
  parseFriendlySchedule,
  type AutomationScheduleEvent,
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

function formatTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function orderAutomations(items: Automation[]): Automation[] {
  return [...items].sort((left, right) => {
    if (left.status === right.status) return 0;
    return left.status === 'active' ? -1 : 1;
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
  const [filter, setFilter] = useState<AutomationFilter>('all');
  const [draft, setDraft] = useState<AutomationDraft>(() => makeDraft(DEFAULT_PROVIDER));

  const defaultProvider = isValidRuntimeId(defaultRuntime) ? defaultRuntime : DEFAULT_PROVIDER;
  const items = useMemo(() => orderAutomations(automationsData ?? []), [automationsData]);
  const history = useMemo(() => historyData ?? [], [historyData]);
  const activeItems = useMemo(() => items.filter((item) => item.status === 'active'), [items]);
  const pausedItems = useMemo(() => items.filter((item) => item.status === 'paused'), [items]);
  const visibleItems = useMemo(() => {
    if (filter === 'active') return activeItems;
    if (filter === 'paused') return pausedItems;
    return items;
  }, [activeItems, filter, items, pausedItems]);
  const latestRuns = useMemo(() => {
    const map = new Map<string, AutomationRun>();
    for (const run of history) {
      if (!map.has(run.automationId)) map.set(run.automationId, run);
    }
    return map;
  }, [history]);
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
    if (entry.source === 'codex') return;
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
              <h1 className="text-2xl font-semibold tracking-tight">{t('automation.title')}</h1>
              <p className="mt-1.5 text-sm leading-6 text-foreground-muted">
                {t('automation.subtitle')}
              </p>
            </div>
          )}
          <Button type="button" onClick={openCreate}>
            <Plus className="size-4" />
            {t('automation.new')}
          </Button>
        </header>

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

        <AutomationScheduleOverview items={items} />

        <section className="mt-5 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-foreground-muted">
              {t('automation.listCount', { count: items.length })}
            </h2>
            <AutomationFilterControl
              value={filter}
              activeCount={activeItems.length}
              pausedCount={pausedItems.length}
              totalCount={items.length}
              onChange={setFilter}
            />
          </div>

          <div className="mt-3">
            {visibleItems.length === 0 ? (
              <AutomationEmptyState
                filter={filter}
                hasAutomations={items.length > 0}
                onCreate={openCreate}
              />
            ) : (
              <div className="overflow-hidden rounded-lg border border-border bg-background divide-y divide-border">
                {visibleItems.map((entry) => (
                  <AutomationAccordionRow
                    key={entry.id}
                    entry={entry}
                    isRunning={runningId === entry.id}
                    isUpdating={updatingId === entry.id}
                    lastRun={latestRuns.get(entry.id)}
                    onEdit={openEdit}
                    onDelete={handleDelete}
                    onRun={handleRun}
                    onToggle={handleToggle}
                    onOpenRun={(run) => {
                      if (!run.taskId) return;
                      openTaskTarget(
                        {
                          projectId: INTERNAL_PROJECT_ID,
                          taskId: run.taskId,
                          ...(run.conversationId ? { conversationId: run.conversationId } : {}),
                        },
                        navigate
                      );
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
});

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
    { id: 'all', label: t('automation.filters.all'), count: totalCount },
    { id: 'active', label: t('automation.filters.active'), count: activeCount },
    { id: 'paused', label: t('automation.filters.paused'), count: pausedCount },
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

function AutomationScheduleOverview({ items }: { items: Automation[] }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const [now, setNow] = useState(() => new Date());
  const events = useMemo(() => buildAutomationSchedulePreview(items, now), [items, now]);
  const days = useMemo(() => buildAutomationTimelineDays(events, now), [events, now]);
  const scheduledCount = items.filter(
    (item) => item.status === 'active' && item.triggerKind === 'cron' && item.cronExpr
  ).length;

  React.useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <section
      data-schedule-timeline
      className="mt-5 overflow-hidden rounded-lg border border-border bg-background"
      aria-labelledby="automation-schedule-overview-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-4 py-3.5 @3xl:px-5">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-foreground-passive">
            {t('automation.timeline.label')}
          </p>
          <h2 id="automation-schedule-overview-title" className="mt-0.5 text-sm font-semibold">
            {t('automation.timeline.title')}
          </h2>
          <p className="mt-1 text-xs leading-5 text-foreground-muted">
            {t('automation.timeline.description')}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs text-foreground-muted">
          <span>{t('automation.timeline.scheduledCount', { count: scheduledCount })}</span>
          {events.length > 0 && (
            <span aria-hidden="true" className="text-foreground-passive">
              ·
            </span>
          )}
          {events.length > 0 && (
            <span>{t('automation.timeline.eventCount', { count: events.length })}</span>
          )}
        </div>
      </div>

      {events.length === 0 ? (
        <p className="px-4 py-5 text-sm text-foreground-muted @3xl:px-5">
          {t('automation.timeline.empty')}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-px bg-border/70 @2xl:grid-cols-2 @4xl:grid-cols-4 @5xl:grid-cols-7">
          {days.map((day) => (
            <section key={day.start.toISOString()} className="min-h-32 bg-background px-3 py-3">
              <time
                dateTime={day.start.toISOString().slice(0, 10)}
                className="block text-[11px] font-medium text-foreground-muted"
              >
                {isSameCalendarDay(day.start, now)
                  ? t('automation.timeline.today')
                  : formatTimelineDay(day.start, locale)}
              </time>
              {day.events.length === 0 ? (
                <p className="mt-3 text-xs text-foreground-passive">
                  {t('automation.timeline.noEvents')}
                </p>
              ) : (
                <ol className="mt-2.5 space-y-1.5">
                  {day.events.map((event) => (
                    <li
                      key={`${event.automationId}:${event.scheduledAt}`}
                      className="flex min-w-0 items-baseline gap-2 text-xs"
                      title={`${event.title} · ${formatTimelineTime(event.scheduledAt, locale)}`}
                    >
                      <time
                        dateTime={event.scheduledAt}
                        className="shrink-0 tabular-nums text-foreground-muted"
                      >
                        {formatTimelineTime(event.scheduledAt, locale)}
                      </time>
                      <span className="min-w-0 truncate text-foreground">{event.title}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function buildAutomationTimelineDays(
  events: AutomationScheduleEvent[],
  now: Date
): Array<{ start: Date; events: AutomationScheduleEvent[] }> {
  const firstDay = new Date(now);
  firstDay.setHours(0, 0, 0, 0);

  return Array.from({ length: AUTOMATION_SCHEDULE_PREVIEW_DAYS }, (_, index) => {
    const start = new Date(firstDay);
    start.setDate(start.getDate() + index);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    return {
      start,
      events: events.filter((event) => {
        const scheduledAt = new Date(event.scheduledAt).getTime();
        return scheduledAt >= start.getTime() && scheduledAt < end.getTime();
      }),
    };
  });
}

function isSameCalendarDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function formatTimelineDay(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
  }).format(date);
}

function formatTimelineTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
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
      className: 'text-amber-600 dark:text-amber-400',
    },
    success: {
      icon: CheckCircle2,
      className: 'text-emerald-600 dark:text-emerald-400',
    },
    failed: {
      icon: XCircle,
      className: 'text-red-600 dark:text-red-400',
    },
    skipped: {
      icon: CircleDashed,
      className: 'text-foreground-muted',
    },
  };

const AutomationAccordionRow = observer(function AutomationAccordionRow({
  entry,
  isRunning,
  isUpdating,
  lastRun,
  onEdit,
  onDelete,
  onRun,
  onToggle,
  onOpenRun,
}: {
  entry: Automation;
  isRunning: boolean;
  isUpdating: boolean;
  lastRun: AutomationRun | undefined;
  onEdit: (entry: Automation) => void;
  onDelete: (entry: Automation) => void;
  onRun: (entry: Automation) => void;
  onToggle: (entry: Automation) => void;
  onOpenRun: (run: Pick<AutomationRun, 'taskId' | 'conversationId'>) => void;
}) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const runtime = RUNTIMES.find((item) => item.id === entry.runtime);
  const syncedFromCodex = entry.source === 'codex';
  const friendlySchedule = entry.cronExpr ? parseFriendlySchedule(entry.cronExpr) : null;
  const scheduleDescription =
    entry.triggerKind === 'manual'
      ? t('automation.schedule.manual')
      : friendlySchedule
        ? [
            t(`automation.form.scheduleKinds.${friendlySchedule.kind}`),
            friendlySchedule.kind === 'weekly'
              ? t(`automation.form.weekdays.${friendlySchedule.weekday}`)
              : null,
            friendlySchedule.time,
          ]
            .filter(Boolean)
            .join(' · ')
        : entry.cronExpr || t('automation.schedule.pending');
  const nextRunDescription = entry.nextRunAt
    ? formatTime(entry.nextRunAt, locale)
    : t('automation.schedule.pending');
  const runStyle = lastRun ? RUN_STATUS_STYLES[lastRun.status] : null;
  const RunStatusIcon = runStyle?.icon;
  const lastRunAt = lastRun?.startedAt ?? entry.lastRunAt;

  const copyBasics = async () => {
    const details = [
      `${t('automation.form.title')}: ${entry.title}`,
      `${t('automation.form.workspace')}: ${entry.workspaceName}`,
      `${t('automation.form.agent')}: ${runtime?.name ?? entry.runtime}`,
      `${t('automation.form.trigger')}: ${t(`automation.trigger.${entry.triggerKind}`)}`,
      `${t('automation.card.schedule')}: ${scheduleDescription}`,
      entry.triggerKind === 'cron' && entry.cronExpr
        ? `${t('automation.form.cron')}: ${entry.cronExpr}`
        : null,
      entry.triggerKind === 'cron'
        ? `${t('automation.timeline.nextRun')}: ${nextRunDescription}`
        : null,
      '',
      `${t('automation.form.prompt')}:`,
      entry.prompt,
    ]
      .filter((line): line is string => line !== null)
      .join('\n');

    try {
      await copyTextToClipboard(details);
      toast({ title: t('automation.copySucceeded') });
    } catch (error) {
      toast({
        title: t('automation.copyFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  return (
    <article className="min-w-0 bg-background">
      <Collapsible className="transition-colors data-[panel-open]:bg-background-1/20">
        <div className="flex min-h-12 min-w-0 items-center gap-2 pr-3 transition-colors hover:bg-background-1/60">
          <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50">
            <ChevronRight
              className="size-3.5 shrink-0 text-foreground-muted transition-transform group-data-[panel-open]:rotate-90"
              aria-hidden="true"
            />
            <h3 className="min-w-0 truncate text-sm font-medium tracking-tight">{entry.title}</h3>
          </CollapsibleTrigger>
          <Switch
            size="sm"
            checked={entry.status === 'active'}
            disabled={syncedFromCodex || isUpdating}
            onCheckedChange={syncedFromCodex ? undefined : () => onToggle(entry)}
            aria-label={
              syncedFromCodex
                ? t('automation.source.codexManaged')
                : entry.status === 'active'
                  ? t('automation.actions.pause')
                  : t('automation.actions.resume')
            }
          />
        </div>

        <CollapsibleContent>
          <div className="border-t border-border/70 px-4 py-4 @3xl:px-5">
            <p className="max-w-3xl text-sm leading-6 text-foreground-muted">{entry.prompt}</p>

            <dl className="mt-4 grid gap-x-6 gap-y-3 @3xl:grid-cols-2 @5xl:grid-cols-3">
              <AutomationDetail icon={CalendarClock} label={t('automation.card.schedule')}>
                <span>{scheduleDescription}</span>
                {entry.triggerKind === 'cron' && entry.cronExpr && (
                  <code className="font-mono text-[11px] text-foreground-passive">
                    {entry.cronExpr}
                  </code>
                )}
              </AutomationDetail>
              <AutomationDetail icon={Clock3} label={t('automation.timeline.nextRun')}>
                {entry.triggerKind === 'cron' ? nextRunDescription : t('automation.card.neverRun')}
              </AutomationDetail>
              <AutomationDetail icon={Folder} label={t('automation.card.workspace')}>
                {entry.workspaceName}
              </AutomationDetail>
              <AutomationDetail icon={Bot} label={t('automation.form.agent')}>
                {runtime?.name ?? entry.runtime}
              </AutomationDetail>
              <AutomationDetail icon={History} label={t('automation.card.lastRun')}>
                {lastRunAt ? (
                  <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                    <RelativeTime value={lastRunAt} />
                    {lastRun && runStyle && RunStatusIcon && (
                      <span className={cn('inline-flex items-center gap-1', runStyle.className)}>
                        <RunStatusIcon
                          className={cn('size-3', lastRun.status === 'running' && 'animate-spin')}
                        />
                        {t(`automation.runStatus.${lastRun.status}`)}
                      </span>
                    )}
                  </span>
                ) : (
                  t('automation.card.neverRun')
                )}
              </AutomationDetail>
            </dl>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3">
              <div className="flex min-w-0 items-center gap-2 text-xs text-foreground-muted">
                <span
                  className="inline-flex min-w-0 items-center gap-1.5"
                  title={syncedFromCodex ? t('automation.source.codexHint') : undefined}
                >
                  {syncedFromCodex ? (
                    <RefreshCw className="size-3.5 shrink-0" />
                  ) : (
                    <Settings2 className="size-3.5 shrink-0" />
                  )}
                  {syncedFromCodex
                    ? t('automation.source.codexManaged')
                    : t('automation.source.yodaManaged')}
                </span>
                {syncedFromCodex && (
                  <Badge variant="outline" className="gap-1.5 text-foreground-muted">
                    <Lock className="size-3" />
                    {t('automation.source.readOnly')}
                  </Badge>
                )}
              </div>

              <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                <Button type="button" variant="ghost" size="sm" onClick={() => void copyBasics()}>
                  <ClipboardCopy className="size-3.5" />
                  {t('automation.actions.copyInfo')}
                </Button>
                {lastRun?.taskId && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('automation.card.openLastRun', { name: entry.title })}
                    onClick={() => onOpenRun(lastRun)}
                  >
                    <MessageSquare className="size-3.5" />
                    {t('automation.card.continueSession')}
                  </Button>
                )}
                {!syncedFromCodex && (
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
                )}
                {!syncedFromCodex && (
                  <DropdownMenu>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <DropdownMenuTrigger
                            aria-label={t('automation.actions.more', { name: entry.title })}
                            className="flex size-8 shrink-0 items-center justify-center rounded-md text-foreground-muted outline-none transition-colors hover:bg-background-1 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                          />
                        }
                      >
                        <MoreHorizontal className="size-4" />
                      </TooltipTrigger>
                      <TooltipContent>
                        {t('automation.actions.more', { name: entry.title })}
                      </TooltipContent>
                    </Tooltip>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem onClick={() => onEdit(entry)}>
                        <Pencil className="size-4" />
                        {t('automation.actions.edit')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={() => onDelete(entry)}>
                        <Trash2 className="size-4" />
                        {t('automation.actions.delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </article>
  );
});

function AutomationDetail({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[11px] font-medium text-foreground-passive">
        <Icon className="size-3 shrink-0" />
        {label}
      </dt>
      <dd className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs leading-5 text-foreground-muted">
        {children}
      </dd>
    </div>
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
