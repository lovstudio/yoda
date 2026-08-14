import {
  CircleDashed,
  CircleStop,
  Copy,
  Loader2,
  MoreHorizontal,
  Radio,
  Terminal,
  UserRoundCog,
  XCircle,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDefaultLayout } from 'react-resizable-panels';
import type { BackgroundJob, BackgroundJobKind } from '@shared/agent-background-jobs';
import { conversationTranscriptChangedChannel } from '@shared/events/conversationEvents';
import { getTaskMenuConversation } from '@renderer/features/tasks/components/task-menu-session-info';
import {
  useRequireProvisionedTask,
  useTaskViewContext,
} from '@renderer/features/tasks/task-view-context';
import { events, rpc } from '@renderer/lib/ipc';
import { writeTextToClipboard } from '@renderer/lib/pty/terminal-clipboard';
import { appState } from '@renderer/lib/stores/app-state';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@renderer/lib/ui/resizable';
import { cn } from '@renderer/utils/utils';

/**
 * Read-only view of the background jobs a Claude session left running after its
 * turn ended (`Bash run_in_background`, `Monitor`, async sub-agents).
 *
 * Two primitives — the row list and the output tail — are arranged differently
 * per surface: stacked inside the narrow Session blind, side by side in the
 * bottom drawer. Neither can stop a job: the transcript records no pid, so the
 * honest affordance is copying the task id and asking the agent.
 */

const KIND_ICONS: Record<BackgroundJobKind, React.ReactNode> = {
  bash: <Terminal className="size-3" />,
  monitor: <Radio className="size-3" />,
  agent: <UserRoundCog className="size-3" />,
};

/** Same vocabulary as the automation run list, so run state reads identically. */
const STATUS_STYLES: Record<
  BackgroundJob['status'],
  { icon: React.ElementType; className: string }
> = {
  running: { icon: Loader2, className: 'text-amber-600 dark:text-amber-400' },
  completed: { icon: CircleDashed, className: 'text-emerald-600 dark:text-emerald-400' },
  failed: { icon: XCircle, className: 'text-red-600 dark:text-red-400' },
  stopped: { icon: CircleStop, className: 'text-foreground-muted' },
};

/** Stable identity, so "nothing loaded yet" never looks like a new list. */
const EMPTY_JOBS: BackgroundJob[] = [];

/**
 * Loads the job list for the task's current conversation and keeps it fresh off
 * the transcript watcher — the same push the transcript blind uses, because the
 * transcript is where job starts and completions are recorded.
 */
export function useConversationBackgroundJobs(active: boolean): BackgroundJob[] {
  const provisionedTask = useRequireProvisionedTask();
  const conversation = getTaskMenuConversation(provisionedTask);
  const conversationId = conversation?.id;
  const projectId = conversation?.projectId;
  const taskId = conversation?.taskId;
  // Results carry the session they belong to, so switching conversations drops
  // the previous list by derivation instead of a reset effect — and a response
  // that lands after a switch can never repopulate the new session's panel.
  const [loaded, setLoaded] = useState<{ conversationId: string; jobs: BackgroundJob[] } | null>(
    null
  );

  useEffect(() => {
    if (!active || !conversationId || !projectId || !taskId) return;
    let cancelled = false;
    const refetch = () => {
      void rpc.conversations
        .getConversationBackgroundJobs(projectId, taskId, conversationId)
        .then((result) => {
          if (!cancelled) setLoaded({ conversationId, jobs: result });
        })
        .catch(() => {
          if (!cancelled) setLoaded({ conversationId, jobs: [] });
        });
    };
    // Subscribe before the first read so an append landing in between is not lost.
    const off = events.on(conversationTranscriptChangedChannel, refetch, conversationId);
    const subscribed = rpc.conversations.subscribeConversationTranscript(
      projectId,
      taskId,
      conversationId
    );
    void subscribed.then(refetch, refetch);
    return () => {
      cancelled = true;
      off();
      void subscribed
        .then(() =>
          rpc.conversations.unsubscribeConversationTranscript(projectId, taskId, conversationId)
        )
        .catch(() => {});
    };
  }, [active, conversationId, projectId, taskId]);

  return loaded?.conversationId === conversationId ? loaded.jobs : EMPTY_JOBS;
}

/**
 * Header count badge — running jobs. Read from the global runtime mirror rather
 * than the list above: that list only loads while its blind is open, whereas
 * this badge's whole job is to be visible while the blind is collapsed.
 */
export const BackgroundJobsCount = observer(function BackgroundJobsCount() {
  const provisionedTask = useRequireProvisionedTask();
  const conversation = getTaskMenuConversation(provisionedTask);
  if (!conversation) return null;
  const count = appState.agentRuntime.sessionBackgroundJobCount(
    conversation.projectId,
    conversation.taskId,
    conversation.id
  );
  if (count === 0) return null;
  return <span className="px-1.5 font-mono text-[11px] text-foreground-passive">{count}</span>;
});

/** Stacked arrangement for the narrow Session blind. */
export const BackgroundJobsContent = observer(function BackgroundJobsContent({
  jobs,
}: {
  jobs: BackgroundJob[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = jobs.find((job) => job.taskId === selectedId) ?? null;
  if (jobs.length === 0) return <BackgroundJobsEmpty compact />;
  return (
    <div className="flex max-h-80 min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <BackgroundJobsList
          jobs={jobs}
          selectedId={selectedId}
          onSelect={(taskId) => setSelectedId(taskId === selectedId ? null : taskId)}
        />
      </div>
      {selected ? (
        <div className="max-h-40 min-h-0 shrink-0 overflow-hidden border-t border-border/60">
          <BackgroundJobOutput job={selected} />
        </div>
      ) : null}
    </div>
  );
});

/**
 * Bottom-drawer arrangement: output on the left, job list as the right-hand
 * column — the same shape as the terminal drawer, so the two read alike.
 */
export const BackgroundJobsPanel = observer(function BackgroundJobsPanel({
  active,
}: {
  active: boolean;
}) {
  const { taskId } = useTaskViewContext();
  const jobs = useConversationBackgroundJobs(active);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Per-task layout id: a bare constant would make every mounted task's drawer
  // share one width.
  const layoutId = `background-drawer-inner:${taskId}`;
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: layoutId,
    storage: localStorage,
  });
  const selected = jobs.find((job) => job.taskId === selectedId) ?? null;

  if (jobs.length === 0) return <BackgroundJobsEmpty />;

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      id={layoutId}
      className="h-full"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      <ResizablePanel id={`${layoutId}:output`} minSize="30%">
        {selected ? (
          <BackgroundJobOutput job={selected} className="h-full" />
        ) : (
          <BackgroundJobsEmpty selectPrompt />
        )}
      </ResizablePanel>
      <ResizableHandle className="hover:bg-background-2" />
      <ResizablePanel id={`${layoutId}:list`} defaultSize="25%" minSize="150px" maxSize="50%">
        <div className="h-full overflow-y-auto bg-background-1/20">
          <BackgroundJobsList jobs={jobs} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
});

/** The one row-list implementation both surfaces render. */
const BackgroundJobsList = observer(function BackgroundJobsList({
  jobs,
  selectedId,
  onSelect,
}: {
  jobs: BackgroundJob[];
  selectedId: string | null;
  onSelect: (taskId: string) => void;
}) {
  return (
    <ul className="flex min-w-0 flex-col">
      {jobs.map((job) => (
        <BackgroundJobRow
          key={job.taskId}
          job={job}
          selected={job.taskId === selectedId}
          onSelect={() => onSelect(job.taskId)}
        />
      ))}
    </ul>
  );
});

const BackgroundJobRow = observer(function BackgroundJobRow({
  job,
  selected,
  onSelect,
}: {
  job: BackgroundJob;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const { icon: StatusIcon, className: statusClass } = STATUS_STYLES[job.status];
  const label = job.description?.trim() || job.command?.trim() || job.taskId;

  return (
    <li className="min-w-0">
      <div
        className={cn(
          'group/job flex min-w-0 items-center gap-2 border-b border-border/40 px-2 py-1.5 text-xs',
          selected ? 'bg-background-2' : 'hover:bg-background-2/60'
        )}
      >
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border"
          title={t(`tasks.backgroundJobs.status.${job.status}`)}
        >
          <StatusIcon
            className={cn(
              'size-3 shrink-0',
              statusClass,
              job.status === 'running' && 'motion-safe:animate-spin'
            )}
            aria-label={t(`tasks.backgroundJobs.status.${job.status}`)}
          />
          <span
            className="shrink-0 text-foreground-passive"
            title={t(`tasks.backgroundJobs.kind.${job.kind}`)}
          >
            {KIND_ICONS[job.kind]}
          </span>
          <span className="min-w-0 flex-1 truncate text-foreground" title={label}>
            {label}
          </span>
          <RelativeTime
            value={job.startedAt}
            compact
            ago
            className="shrink-0 text-[10px] text-foreground-passive"
          />
        </button>
        <BackgroundJobMenu job={job} />
      </div>
    </li>
  );
});

/**
 * Copy-only actions. Stopping a job is not offered because Yoda has no handle
 * on the detached process; the task id is what the user pastes to the agent.
 */
const BackgroundJobMenu = observer(function BackgroundJobMenu({ job }: { job: BackgroundJob }) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('common.more')}
        title={t('common.more')}
        className="flex size-5 shrink-0 items-center justify-center rounded-sm text-foreground-passive opacity-0 transition-opacity hover:bg-background-1 hover:text-foreground focus-visible:opacity-100 group-hover/job:opacity-100"
      >
        <MoreHorizontal className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={() => writeTextToClipboard(job.taskId)}>
          <Copy className="size-3.5" />
          {t('tasks.backgroundJobs.copyTaskId')}
        </DropdownMenuItem>
        {job.command ? (
          <DropdownMenuItem onClick={() => writeTextToClipboard(job.command ?? '')}>
            <Copy className="size-3.5" />
            {t('tasks.backgroundJobs.copyCommand')}
          </DropdownMenuItem>
        ) : null}
        {job.outputPath ? (
          <DropdownMenuItem onClick={() => writeTextToClipboard(job.outputPath ?? '')}>
            <Copy className="size-3.5" />
            {t('tasks.backgroundJobs.copyOutputPath')}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

/** Tail of one job's output file, refetched whenever the selection changes. */
const BackgroundJobOutput = observer(function BackgroundJobOutput({
  job,
  className,
}: {
  job: BackgroundJob;
  className?: string;
}) {
  const { t } = useTranslation();
  const provisionedTask = useRequireProvisionedTask();
  const conversation = getTaskMenuConversation(provisionedTask);
  const [tail, setTail] = useState<{ text: string; truncated: boolean } | null>(null);

  const conversationId = conversation?.id;
  const projectId = conversation?.projectId;
  const taskId = conversation?.taskId;
  const jobTaskId = job.taskId;
  // Re-read on every output-file write; `lastOutputAt` is that write's mtime.
  const lastOutputAt = job.lastOutputAt;

  const load = useCallback(async () => {
    if (!conversationId || !projectId || !taskId) return null;
    return await rpc.conversations
      .getConversationBackgroundJobOutputTail(projectId, taskId, conversationId, jobTaskId)
      .catch(() => null);
  }, [conversationId, projectId, taskId, jobTaskId]);

  useEffect(() => {
    let cancelled = false;
    void load().then((result) => {
      if (cancelled) return;
      setTail(result ? { text: result.text, truncated: result.truncated } : null);
    });
    return () => {
      cancelled = true;
    };
  }, [load, lastOutputAt]);

  const text = tail?.text.trimEnd() ?? '';

  return (
    <div className={cn('flex min-h-0 flex-col overflow-hidden', className)}>
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-2 py-1 text-[10px] text-foreground-passive">
        <span className="min-w-0 truncate font-mono" title={job.outputPath}>
          {job.outputPath ?? t('tasks.backgroundJobs.noOutputFile')}
        </span>
        {tail?.truncated ? (
          <span className="ml-auto shrink-0">{t('tasks.backgroundJobs.tailTruncated')}</span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {text ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground">
            {text}
          </pre>
        ) : (
          <p className="text-[11px] text-foreground-passive">
            {t('tasks.backgroundJobs.outputEmpty')}
          </p>
        )}
      </div>
    </div>
  );
});

function BackgroundJobsEmpty({
  compact,
  selectPrompt,
}: {
  compact?: boolean;
  selectPrompt?: boolean;
}) {
  const { t } = useTranslation();
  const label = selectPrompt
    ? t('tasks.backgroundJobs.selectJob')
    : t('tasks.backgroundJobs.empty');
  const description = selectPrompt ? undefined : t('tasks.backgroundJobs.emptyDescription');
  if (compact) {
    return (
      <p className="px-3 py-3 text-[11px] leading-relaxed text-foreground-passive">
        {t('tasks.backgroundJobs.emptyDescription')}
      </p>
    );
  }
  return <EmptyState label={label} description={description} />;
}
