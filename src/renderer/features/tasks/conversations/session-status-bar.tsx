import {
  Check,
  ChevronDown,
  ChevronUp,
  MessageSquareText,
  MoreHorizontal,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClaudeSessionPrompt } from '@shared/conversations';
import {
  SESSION_STATUS_BAR_SOURCE_IDS,
  type SessionStatusBarSource,
} from '@shared/session-status-bar';
import { displaySessionPromptText } from '@renderer/features/tasks/context-panel-prompt-display';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import {
  SummaryInlineControls,
  useSessionPrompts,
  useSessionSummary,
} from '@renderer/features/tasks/session-info-panel';
import { buildPromptPreviewItems } from '@renderer/features/tasks/session-prompts-preview';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';

/** What a status-bar source resolves to for one render. */
type StatusBarContent = {
  hasConversation: boolean;
  /** Main text shown in the bar. */
  body: string;
  /** Tooltip / aria description. */
  tooltip: string;
  /** Hover-revealed controls on the right (e.g. summary regenerate/config). */
  controls?: React.ReactNode;
};

/** Icon shown in the source switcher for each source. */
const SOURCE_ICONS: Record<Exclude<SessionStatusBarSource, 'off'>, React.ReactNode> = {
  summary: <Sparkles className="size-3" />,
  recentPrompt: <MessageSquareText className="size-3" />,
};

const BODY_CLASS =
  'min-w-0 truncate text-left text-[13px] leading-5 text-[var(--xterm-fg)] opacity-75';

/** Small solid-background chip so an affordance icon stays readable over text. */
function AffordanceChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex h-5 items-center justify-center rounded-sm bg-[var(--xterm-bg)] px-1.5 text-[var(--xterm-fg)] ring-1 ring-foreground/15">
      {children}
    </span>
  );
}

/**
 * The strip below the terminal. Shows ONE configurable content source at a
 * time (latest user prompt, session summary, …) with a switcher to change it.
 * The selected source is a global task setting.
 */
export const SessionStatusBar = observer(function SessionStatusBar({
  active,
}: {
  active: boolean;
}) {
  const { t } = useTranslation();
  const taskSettings = useTaskSettings();
  const source = taskSettings.statusBarSource;

  // Both sources' hooks run unconditionally (Rules of Hooks), but each only
  // fetches when it is the selected source — so the unselected one is idle and
  // never spawns work.
  const summary = useSessionSummary(active && source === 'summary', 'recent');
  const prompts = useSessionPrompts(active && source === 'recentPrompt');

  if (source === 'off') return null;

  const content = resolveContent(source, { summary, prompts, t });
  if (!content.hasConversation) return null;

  // The bar itself always shows the newest prompt; the blind above it only
  // unfolds the OLDER ones, stacked oldest-to-newest so the bar reads as the
  // bottom entry of the list.
  const isPromptSource = source === 'recentPrompt';
  const olderPrompts = isPromptSource ? prompts.prompts.slice(0, -1) : [];
  const expanded =
    isPromptSource && taskSettings.statusBarPromptsExpanded && olderPrompts.length > 0;

  return (
    <section className="group/status relative min-w-0 shrink-0 bg-[var(--xterm-bg)]">
      <div aria-hidden className="h-0.5 bg-[var(--xterm-bg)]" />
      {olderPrompts.length > 0 ? (
        // In-flow blind: animating the grid row pushes the terminal above it
        // up/down instead of overlaying it.
        <div
          className={cn(
            'grid transition-[grid-template-rows] duration-200',
            expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          )}
        >
          <div className="relative min-h-0 overflow-hidden">
            <PromptHistoryRows
              prompts={olderPrompts}
              head={taskSettings.statusBarPromptHead}
              // The tail count includes the bar's own newest entry below.
              tail={taskSettings.statusBarPromptTail - 1}
              onOpenAll={prompts.openPromptsModal}
            />
            {/* Collapse affordance: centered on the topmost row, hover-revealed. */}
            <button
              type="button"
              onClick={() => taskSettings.updateStatusBarPromptsExpanded(false)}
              className="absolute left-1/2 top-1 z-10 -translate-x-1/2 opacity-0 transition-opacity group-hover/status:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
              aria-label={t('tasks.sessionPanel.statusBar.collapseHistory')}
              title={t('tasks.sessionPanel.statusBar.collapseHistory')}
            >
              <AffordanceChip>
                <ChevronDown className="size-3" />
              </AffordanceChip>
            </button>
          </div>
        </div>
      ) : null}
      <div
        className={cn(
          'relative flex h-7 w-full min-w-0 items-center bg-[var(--xterm-bg)] pl-3 pr-9',
          // When the blind is up, the separator moves to its top edge so the
          // rows and the bar read as one continuous list.
          !expanded && 'border-t border-foreground/10'
        )}
      >
        {olderPrompts.length > 0 ? (
          <button
            type="button"
            onClick={() =>
              taskSettings.updateStatusBarPromptsExpanded(!taskSettings.statusBarPromptsExpanded)
            }
            className="relative flex min-w-0 flex-1 items-center justify-start"
            aria-label={content.tooltip}
            aria-expanded={expanded}
          >
            <span
              className={cn(BODY_CLASS, 'transition-opacity hover:opacity-100')}
              title={content.body}
            >
              {content.body}
            </span>
            {!expanded ? (
              // Expand affordance: centered on the bar, hover-revealed.
              <span
                aria-hidden
                className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/status:opacity-100"
              >
                <AffordanceChip>
                  <ChevronUp className="size-3" />
                </AffordanceChip>
              </span>
            ) : null}
          </button>
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={
                <div
                  role="status"
                  className="flex min-w-0 flex-1 items-center justify-start"
                  aria-label={content.tooltip}
                />
              }
            >
              <span className={BODY_CLASS} title={content.body}>
                {content.body}
              </span>
            </TooltipTrigger>
            <TooltipContent>{content.tooltip}</TooltipContent>
          </Tooltip>
        )}
        <div className="absolute inset-y-0 right-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/status:opacity-100 focus-within:opacity-100">
          {content.controls}
          <SourceSwitcher
            source={source}
            onSelect={(next) => taskSettings.updateStatusBarSource(next)}
          />
        </div>
      </div>
    </section>
  );
});

function resolveContent(
  source: Exclude<SessionStatusBarSource, 'off'>,
  deps: {
    summary: ReturnType<typeof useSessionSummary>;
    prompts: ReturnType<typeof useSessionPrompts>;
    t: (key: string) => string;
  }
): StatusBarContent {
  const { summary, prompts, t } = deps;

  if (source === 'recentPrompt') {
    const latest = prompts.prompts[prompts.prompts.length - 1];
    const text = latest ? displaySessionPromptText(latest.text).trim() : '';
    return {
      hasConversation: prompts.hasConversation,
      body: text || t('tasks.sessionPanel.statusBar.recentPromptEmpty'),
      tooltip: t('tasks.sessionPanel.statusBar.recentPromptTooltip'),
    };
  }

  // 'summary'
  const text = summary.streamingText.trim() || summary.summary?.text.trim();
  const body = text
    ? text
    : summary.isGenerating
      ? t('tasks.sessionPanel.summaryGenerating')
      : summary.status === 'running'
        ? t('tasks.sessionPanel.summaryRunningDescription')
        : summary.status === 'failed'
          ? t('tasks.sessionPanel.summaryFailedDescription')
          : t('tasks.sessionPanel.summaryEmptyDescription');
  return {
    hasConversation: summary.hasConversation,
    body,
    tooltip: t('tasks.sessionPanel.recentProgressTooltip'),
    controls: <SummaryInlineControls summary={summary} />,
  };
}

/**
 * The unfolded prompt history above the bar: first `head` / last `tail`
 * prompts with the middle elided. The elided-middle row opens the full
 * history modal.
 */
function PromptHistoryRows({
  prompts,
  head,
  tail,
  onOpenAll,
}: {
  prompts: ClaudeSessionPrompt[];
  head: number;
  tail: number;
  onOpenAll: () => void;
}) {
  const { t } = useTranslation();
  const items = buildPromptPreviewItems(prompts, head, tail);
  return (
    <div className="flex flex-col border-t border-foreground/10 py-0.5">
      {items.map((item) =>
        item.type === 'truncated' ? (
          <button
            key="truncated"
            type="button"
            className="flex h-6 w-full items-center justify-start gap-1.5 pl-3 pr-9 text-[11px] leading-5 text-[var(--xterm-fg)] opacity-45 transition-opacity hover:opacity-100"
            onClick={onOpenAll}
          >
            <MoreHorizontal className="size-3" />
            {t('tasks.sessionInfo.truncatedPrompts', { count: item.hiddenCount })}
          </button>
        ) : (
          <BlindPromptRow
            key={item.prompt.id || `prompt-${item.promptIndex}`}
            prompt={item.prompt}
          />
        )
      )}
    </div>
  );
}

/** One older prompt inside the blind, styled like a dimmer copy of the bar. */
function BlindPromptRow({ prompt }: { prompt: ClaudeSessionPrompt }) {
  const text = displaySessionPromptText(prompt.text).trim();
  return (
    <div className="flex h-6 w-full min-w-0 items-center justify-start pl-3 pr-9" title={text}>
      <span className={cn(BODY_CLASS, 'opacity-55')}>{text}</span>
    </div>
  );
}

/** Compact dropdown to pick which source the status bar shows. */
const SourceSwitcher = observer(function SourceSwitcher({
  source,
  onSelect,
}: {
  source: SessionStatusBarSource;
  onSelect: (next: SessionStatusBarSource) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const label = (id: SessionStatusBarSource) => t(`tasks.sessionPanel.statusBar.source.${id}`);
  return (
    <div className="flex items-center">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="flex size-5 items-center justify-center rounded-sm text-[var(--xterm-fg)] opacity-50 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
              aria-label={t('tasks.sessionPanel.statusBar.switchSource')}
              title={t('tasks.sessionPanel.statusBar.switchSource')}
            >
              <Settings2 className="size-3" />
            </button>
          }
        />
        <PopoverContent align="end" side="top" className="w-48 gap-0 p-1">
          {SESSION_STATUS_BAR_SOURCE_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-background-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
              onClick={() => {
                onSelect(id);
                setOpen(false);
              }}
            >
              <span className="flex size-3.5 shrink-0 items-center justify-center text-foreground-passive">
                {id === 'off' ? null : SOURCE_ICONS[id]}
              </span>
              <span className="min-w-0 flex-1 truncate">{label(id)}</span>
              {source === id ? <Check className="size-3 shrink-0 text-foreground" /> : null}
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
});
