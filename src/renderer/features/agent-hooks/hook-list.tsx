import { Info } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { InspectedHook } from '@shared/agent-hooks';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { Switch } from '@renderer/lib/ui/switch';
import { cn } from '@renderer/utils/utils';

/**
 * How a surface binds the shared hook rows to its own context: the task panel
 * toggles per-task overrides and opens files in the workspace editor, the
 * Library shows the same rows read-only with context-free path actions.
 */
export interface HookListSurface {
  /** Omit for read-only surfaces (no per-task override layer to write to). */
  onToggle?: (hook: InspectedHook, enabled: boolean) => void | Promise<void>;
  /** Shortens the source path in the details popover; absolute when omitted. */
  displaySourcePath?: (sourcePath: string) => string;
  /** Path actions for the hook's settings file. */
  renderFileActions?: (sourcePath: string) => ReactNode;
}

export function HookGroupSection({
  group,
  surface,
}: {
  group: HookGroup;
  surface: HookListSurface;
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
          <HookRow key={hook.id} hook={hook} surface={surface} />
        ))}
      </div>
    </section>
  );
}

const HookRow = observer(function HookRow({
  hook,
  surface,
}: {
  hook: InspectedHook;
  surface: HookListSurface;
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
      <HookDetailsPopover hook={hook} surface={surface} />
    </div>
  );
});

const HookDetailsPopover = observer(function HookDetailsPopover({
  hook,
  surface,
}: {
  hook: InspectedHook;
  surface: HookListSurface;
}) {
  const { t } = useTranslation();
  const sourcePath =
    typeof hook.sourcePath === 'string' && hook.sourcePath.trim().length > 0
      ? hook.sourcePath
      : null;
  const displayPath = sourcePath
    ? (surface.displaySourcePath?.(sourcePath) ?? sourcePath)
    : t('tasks.hooks.sourceUnknown');
  const onToggle = surface.onToggle;

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
        {onToggle ? (
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
        ) : null}

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
          {sourcePath ? surface.renderFileActions?.(sourcePath) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
});

/**
 * Canonical Claude Code hook lifecycle order. Groups are sorted by this so a
 * list reads top-to-bottom in the order hooks actually fire during a session.
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

export interface HookGroup {
  key: string;
  /** Group heading. */
  label: string;
  hooks: InspectedHook[];
}

/** Group hooks by lifecycle event, sorted in firing order. */
export function groupHooks(hooks: InspectedHook[]): HookGroup[] {
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
