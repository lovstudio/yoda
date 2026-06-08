import { Bug, Check, Info, Loader2, RotateCcw, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HookInspectionResult, InspectedHook } from '@shared/agent-hooks';
import { hookExecChannel, type HookExecEvent } from '@shared/events/agentEvents';
import {
  FileActionsDropdown,
  toWorkspaceRelativePath,
} from '@renderer/features/tasks/components/file-actions';
import { getTaskMenuConversation } from '@renderer/features/tasks/components/task-menu-session-info';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { events, rpc } from '@renderer/lib/ipc';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { MicroLabel } from '@renderer/lib/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { Switch } from '@renderer/lib/ui/switch';
import { cn } from '@renderer/utils/utils';

const MAX_LOG_ENTRIES = 200;

export const HooksPanel = observer(function HooksPanel({
  active,
  chromeless = false,
}: {
  active: boolean;
  chromeless?: boolean;
}) {
  const { t } = useTranslation();
  const { taskId } = useTaskViewContext();
  const provisionedTask = useProvisionedTask();
  const conversation = getTaskMenuConversation(provisionedTask);
  const providerId = conversation?.providerId;

  // Re-fetch when the active session restarts (mirrors session-info-panel).
  const sessionStatus = conversation
    ? provisionedTask.conversations.conversations.get(conversation.id)?.session.status
    : undefined;

  const [inspection, setInspection] = useState<HookInspectionResult | null>(null);
  const [debug, setDebug] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [pendingRestart, setPendingRestart] = useState(false);
  const [log, setLog] = useState<HookExecEvent[]>([]);

  const reload = useMemo(
    () => async () => {
      if (!providerId) return;
      setIsLoading(true);
      try {
        const [result, overrides] = await Promise.all([
          rpc.agentHooks.inspect(provisionedTask.path, providerId, taskId),
          rpc.agentHooks.getOverrides(taskId),
        ]);
        setInspection(result);
        setDebug(overrides.debug);
      } finally {
        setIsLoading(false);
      }
    },
    [providerId, provisionedTask.path, taskId]
  );

  useEffect(() => {
    if (!active) return;
    void reload();
  }, [active, reload, sessionStatus]);

  // Live exec log (only meaningful while debug is on).
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    return events.on(
      hookExecChannel,
      (event) => {
        if (event.taskId !== taskId) return;
        setLog((prev) => [...prev.slice(-(MAX_LOG_ENTRIES - 1)), event]);
      },
      taskId
    );
  }, [taskId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const restart = async () => {
    if (!conversation || isRestarting) return;
    setIsRestarting(true);
    try {
      await provisionedTask.conversations.restartConversation(conversation.id);
      setPendingRestart(false);
    } finally {
      setIsRestarting(false);
    }
  };

  const onToggleHook = async (hook: InspectedHook, enabled: boolean) => {
    await rpc.agentHooks.setHookEnabled(taskId, hook.id, enabled);
    await reload();
    setPendingRestart(true);
  };

  const onToggleDebug = async (next: boolean) => {
    setDebug(next);
    await rpc.agentHooks.setDebug(taskId, next);
    if (!next) setLog([]);
    setPendingRestart(true);
  };

  const grouped = useMemo(() => groupHooks(inspection?.hooks ?? []), [inspection]);
  const totals = useMemo(() => {
    const hooks = inspection?.hooks ?? [];
    return { all: hooks.length, on: hooks.filter((h) => h.enabled).length };
  }, [inspection]);

  return (
    <div
      className={cn(
        'flex w-full flex-col overflow-hidden',
        chromeless ? 'min-h-0' : 'h-full bg-background'
      )}
    >
      {chromeless ? null : (
        <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-border/70 pl-3 pr-1.5">
          <MicroLabel className="truncate text-foreground-passive">
            {t('tasks.hooks.title')}
            {totals.all > 0 ? (
              <span className="ml-1.5 normal-case tracking-normal text-foreground-passive/70">
                {totals.on}/{totals.all}
              </span>
            ) : null}
          </MicroLabel>
          {isLoading ? <Loader2 className="size-3.5 animate-spin text-foreground-passive" /> : null}
        </div>
      )}

      <div className={cn(chromeless ? 'min-w-0' : 'min-h-0 flex-1 overflow-y-auto')}>
        <div className="flex min-w-0 flex-col gap-2 px-2.5 py-2">
          {!providerId || inspection?.supported === false ? (
            <EmptyState
              label={t('tasks.hooks.unsupported')}
              description={t('tasks.hooks.unsupportedDescription')}
            />
          ) : (
            <>
              {pendingRestart ? (
                <RestartBanner
                  busy={isRestarting}
                  onClick={() => void restart()}
                  label={t('tasks.hooks.restartToApply')}
                />
              ) : null}

              {grouped.length === 0 ? (
                <EmptyState
                  label={t('tasks.hooks.none')}
                  description={t('tasks.hooks.noneDescription')}
                />
              ) : (
                <div className="flex min-w-0 flex-col gap-3">
                  {grouped.map((group) => (
                    <HookGroupSection key={group.key} group={group} onToggle={onToggleHook} />
                  ))}
                </div>
              )}

              <DebugRow
                debug={debug}
                onToggle={(v) => void onToggleDebug(v)}
                label={t('tasks.hooks.debug')}
                description={t('tasks.hooks.debugDescription')}
              />

              {debug ? <ExecLog ref={logRef} log={log} t={t} /> : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
});

function DebugRow({
  debug,
  onToggle,
  label,
  description,
}: {
  debug: boolean;
  onToggle: (v: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <label
      className={cn(
        'flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm border border-dashed px-1.5 py-1 transition-colors',
        debug ? 'border-primary/40 bg-primary/[0.06]' : 'border-border/80 bg-background-1/40'
      )}
      title={description}
    >
      <Bug
        className={cn('size-3.5 shrink-0', debug ? 'text-primary' : 'text-foreground-passive')}
      />
      <span className="min-w-0 flex-1 truncate text-[11px] text-foreground-muted">{label}</span>
      <Switch checked={debug} onCheckedChange={onToggle} size="sm" className="shrink-0" />
    </label>
  );
}

function RestartBanner({
  busy,
  onClick,
  label,
}: {
  busy: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={cn(
        'group flex min-w-0 items-center gap-1.5 rounded-sm border border-dashed border-primary/50 bg-primary/[0.08] px-1.5 py-1 text-left text-[11px] text-primary',
        'transition-colors hover:bg-primary/[0.14] disabled:opacity-60'
      )}
    >
      {busy ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
      ) : (
        <RotateCcw className="size-3.5 shrink-0 transition-transform group-hover:-rotate-45" />
      )}
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
    </button>
  );
}

function HookGroupSection({
  group,
  onToggle,
}: {
  group: HookGroup;
  onToggle: (hook: InspectedHook, enabled: boolean) => void | Promise<void>;
}) {
  const on = group.hooks.filter((h) => h.enabled).length;
  return (
    <section className="flex min-w-0 flex-col">
      <header className="mb-1 flex min-w-0 items-baseline gap-1.5 border-b border-border/60 px-0.5 pb-1">
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-foreground">
          {group.label}
        </span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-foreground-passive">
          {on}/{group.hooks.length}
        </span>
      </header>
      <div className="flex min-w-0 flex-col">
        {group.hooks.map((hook) => (
          <HookRow key={hook.id} hook={hook} onToggle={onToggle} />
        ))}
      </div>
    </section>
  );
}

const HookRow = observer(function HookRow({
  hook,
  onToggle,
}: {
  hook: InspectedHook;
  onToggle: (hook: InspectedHook, enabled: boolean) => void | Promise<void>;
}) {
  return (
    <div
      className={cn(
        'group/hook flex min-w-0 items-center gap-1.5 rounded-sm px-1.5 py-1 hover:bg-background-1',
        !hook.enabled && 'opacity-45'
      )}
    >
      {hook.matcher ? (
        <span
          className="shrink-0 rounded-sm bg-background-2 px-1 py-px font-mono text-[10px] text-foreground-muted"
          title={hook.matcher}
        >
          {hook.matcher}
        </span>
      ) : null}
      <code
        className={cn(
          'min-w-0 flex-1 truncate font-mono text-[11px] leading-snug',
          hook.enabled
            ? 'text-foreground'
            : 'text-foreground-passive line-through decoration-border'
        )}
        title={hook.command}
      >
        {hook.command}
      </code>
      {hook.managedByYoda ? (
        <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-primary/80">
          yoda
        </span>
      ) : null}
      <HookDetailsPopover hook={hook} onToggle={onToggle} />
    </div>
  );
});

const HookDetailsPopover = observer(function HookDetailsPopover({
  hook,
  onToggle,
}: {
  hook: InspectedHook;
  onToggle: (hook: InspectedHook, enabled: boolean) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const { path: workspaceRoot } = useProvisionedTask();
  const sourcePath =
    typeof hook.sourcePath === 'string' && hook.sourcePath.trim().length > 0
      ? hook.sourcePath
      : null;
  const relative = sourcePath ? toWorkspaceRelativePath(sourcePath, workspaceRoot) : null;
  const displayPath = sourcePath ? (relative ?? sourcePath) : t('tasks.hooks.sourceUnknown');

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="-mr-1 flex size-5 shrink-0 items-center justify-center rounded-sm text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
            aria-label={t('tasks.hooks.details')}
            title={t('tasks.hooks.details')}
          >
            <Info className="size-3.5" />
          </button>
        }
      />
      <PopoverContent align="end" side="left" className="w-80 gap-2 p-2.5 text-left">
        {/* Enable toggle lives here so the row stays a clean single line. */}
        <label className="flex min-w-0 cursor-pointer items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[11px] text-foreground-muted">
            {t('tasks.hooks.enabled')}
          </span>
          <Switch
            checked={hook.enabled}
            onCheckedChange={(v) => void onToggle(hook, v)}
            size="sm"
            className="shrink-0"
          />
        </label>

        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="font-mono text-[10px] text-foreground-passive">{hook.event}</span>
          {hook.matcher ? (
            <span className="rounded-sm bg-background-2 px-1 py-px font-mono text-[10px] text-foreground-muted">
              {hook.matcher}
            </span>
          ) : null}
          {hook.managedByYoda ? (
            <span className="font-mono text-[9px] uppercase tracking-wider text-primary/80">
              yoda
            </span>
          ) : null}
        </div>

        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-sm border border-dashed border-border/80 bg-background-1/40 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground-muted">
          {hook.command}
        </pre>

        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="min-w-0 flex-1 truncate font-mono text-[10px] text-foreground-passive"
            title={sourcePath ?? undefined}
          >
            {displayPath}
          </span>
          {sourcePath ? <FileActionsDropdown sourcePath={sourcePath} /> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
});

const ExecLog = observer(function ExecLog({
  ref,
  log,
  t,
}: {
  ref: React.Ref<HTMLDivElement>;
  log: HookExecEvent[];
  t: (key: string) => string;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <header className="flex min-w-0 items-center gap-1.5 px-0.5">
        <MicroLabel className="shrink-0 text-foreground-passive/80">
          {t('tasks.hooks.execLog')}
        </MicroLabel>
        {log.length > 0 ? (
          <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-foreground-passive">
            {log.length}
          </span>
        ) : null}
      </header>
      <div
        ref={ref}
        className="max-h-64 overflow-y-auto rounded-sm border border-dashed border-border/80 bg-background-1/40 p-1"
      >
        {log.length === 0 ? (
          <div className="flex items-center gap-2 px-2 py-3 text-[11px] text-foreground-passive">
            <span className="size-1.5 animate-pulse rounded-full bg-primary/60" />
            {t('tasks.hooks.execLogEmpty')}
          </div>
        ) : (
          <div className="flex flex-col">
            {log.map((entry, i) => (
              <ExecLogRow key={i} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
});

function ExecLogRow({ entry }: { entry: HookExecEvent }) {
  const ok = entry.exitCode === 0 || entry.exitCode === undefined;
  return (
    <div className="flex gap-2 rounded px-1.5 py-1 hover:bg-background-1/60">
      <span
        className={cn(
          'mt-px flex size-3.5 shrink-0 items-center justify-center rounded-sm',
          ok
            ? 'bg-background-2 text-foreground-muted'
            : 'bg-background-destructive text-foreground-destructive'
        )}
      >
        {ok ? <Check className="size-2.5" /> : <X className="size-2.5" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate font-mono text-[11px] text-foreground">
            {entry.hookEvent || 'hook'}
          </span>
          {!ok ? (
            <span className="shrink-0 font-mono text-[10px] text-foreground-destructive">
              exit {entry.exitCode}
            </span>
          ) : null}
        </div>
        {entry.output ? (
          <pre className="mt-0.5 max-h-24 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-snug text-foreground-passive">
            {entry.output}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Canonical Claude Code hook lifecycle order. Groups are sorted by this so the
 * panel reads top-to-bottom in the order hooks actually fire during a session.
 * Unknown events sort after all known ones, alphabetically.
 */
const LIFECYCLE_ORDER = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'PreCompact',
  'Stop',
  'SubagentStop',
  'SessionEnd',
  // Codex
  'notify',
] as const;

function lifecycleIndex(event: string): number {
  const i = (LIFECYCLE_ORDER as readonly string[]).indexOf(event);
  return i === -1 ? LIFECYCLE_ORDER.length : i;
}

interface HookGroup {
  key: string;
  /** Group heading. */
  label: string;
  hooks: InspectedHook[];
}

/** Group hooks by lifecycle event, sorted in firing order. */
function groupHooks(hooks: InspectedHook[]): HookGroup[] {
  const map = new Map<string, InspectedHook[]>();
  for (const hook of hooks) {
    const list = map.get(hook.event) ?? [];
    list.push(hook);
    map.set(hook.event, list);
  }

  return Array.from(map.entries(), ([key, list]) => ({ key, label: key, hooks: list })).sort(
    (a, b) => {
      const d = lifecycleIndex(a.key) - lifecycleIndex(b.key);
      return d !== 0 ? d : a.key.localeCompare(b.key);
    }
  );
}
