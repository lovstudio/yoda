import type { Terminal } from '@xterm/xterm';
import { Check, ChevronDown, MessageSquareText, Sparkles } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClaudeSessionPrompt } from '@shared/conversations';
import {
  SESSION_STATUS_BAR_SOURCE_IDS,
  type SessionStatusBarSource,
} from '@shared/session-status-bar';
import { getTaskMenuConversation } from '@renderer/features/tasks/components/task-menu-session-info';
import { displaySessionPromptText } from '@renderer/features/tasks/context-panel-prompt-display';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import {
  SessionPromptsPreview,
  SummaryInlineControls,
  useSessionPrompts,
  useSessionSummary,
} from '@renderer/features/tasks/session-info-panel';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import {
  collectTerminalSearchMatches,
  type TerminalSearchBufferLike,
} from '@renderer/lib/pty/terminal-search';
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
  'min-w-0 truncate text-center text-[13px] leading-5 text-[var(--xterm-fg)] opacity-75';

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

  return (
    <section className="group/status relative min-w-0 shrink-0 bg-[var(--xterm-bg)]">
      <div aria-hidden className="h-0.5 bg-[var(--xterm-bg)]" />
      <div className="relative flex h-7 w-full min-w-0 items-center border-t border-foreground/10 bg-[var(--xterm-bg)] px-9">
        <SourceSwitcher
          source={source}
          onSelect={(next) => taskSettings.updateStatusBarSource(next)}
          className="absolute inset-y-0 left-1.5 flex items-center"
        />
        {source === 'recentPrompt' && prompts.hasPrompts ? (
          <PromptHistoryExpander prompts={prompts} body={content.body} label={content.tooltip} />
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={
                <div
                  role="status"
                  className="flex min-w-0 flex-1 items-center justify-center"
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
        {content.controls ? (
          <div className="absolute inset-y-0 right-1.5 flex items-center opacity-0 transition-opacity group-hover/status:opacity-100 focus-within:opacity-100">
            {content.controls}
          </div>
        ) : null}
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
 * The latest-prompt body as a popover trigger: clicking expands the prompt
 * history (first/last few, middle elided) above the bar. Clicking a prompt
 * scrolls the terminal to where it was submitted; the elided-middle row opens
 * the full history modal.
 */
const PromptHistoryExpander = observer(function PromptHistoryExpander({
  prompts,
  body,
  label,
}: {
  prompts: ReturnType<typeof useSessionPrompts>;
  body: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const provisionedTask = useProvisionedTask();
  const conversation = getTaskMenuConversation(provisionedTask);
  const terminal = conversation
    ? provisionedTask.conversations.conversations.get(conversation.id)?.session.pty?.terminal
    : undefined;

  const scrollToPrompt = (prompt: ClaudeSessionPrompt, promptIndex: number) => {
    if (!terminal) return;
    // Repeated prompts produce identical buffer matches — pick the occurrence
    // matching this prompt's position in the history.
    const line = firstPromptLine(prompt.text);
    const occurrence = prompts.prompts
      .slice(0, promptIndex - 1)
      .filter((p) => firstPromptLine(p.text) === line).length;
    scrollTerminalToPromptText(terminal, line, occurrence);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center justify-center"
            aria-label={label}
          />
        }
      >
        <span className={cn(BODY_CLASS, 'transition-opacity hover:opacity-100')} title={body}>
          {body}
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        className="max-h-80 w-[min(40rem,90vw)] gap-0 overflow-y-auto p-1.5"
      >
        <SessionPromptsPreview
          prompts={prompts.prompts}
          isLoading={prompts.isLoading}
          onOpenAll={() => {
            setOpen(false);
            prompts.openPromptsModal();
          }}
          onPromptClick={scrollToPrompt}
        />
      </PopoverContent>
    </Popover>
  );
});

/** First non-empty line of a prompt, as displayed — the buffer search needle. */
function firstPromptLine(text: string): string {
  return (
    displaySessionPromptText(text)
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? ''
  );
}

/**
 * Scroll the terminal to the `occurrence`-th place the prompt's first line
 * appears in the scrollback, selecting the match for visibility. CLIs may
 * hard-wrap long prompts at their input-box width (those rows are NOT marked
 * as wrapped), so progressively shorter prefixes are retried until one hits.
 */
function scrollTerminalToPromptText(terminal: Terminal, line: string, occurrence: number): void {
  const buffer = terminal.buffer?.active as TerminalSearchBufferLike | undefined;
  if (!buffer || !line) return;
  const prefixLengths = [...new Set([line.length, 60, 30, 15].filter((n) => n <= line.length))];
  for (const length of prefixLengths) {
    const query = line.slice(0, length).trim();
    if (!query) continue;
    const matches = collectTerminalSearchMatches(buffer, query);
    if (matches.length === 0) continue;
    const match = matches[Math.min(occurrence, matches.length - 1)];
    try {
      terminal.select(match.col, match.row, match.length);
      const contextRows = Math.max(0, Math.floor(terminal.rows / 2));
      terminal.scrollToLine(Math.max(0, match.row - contextRows));
    } catch {}
    return;
  }
}

/** Compact dropdown to pick which source the status bar shows. */
const SourceSwitcher = observer(function SourceSwitcher({
  source,
  onSelect,
  className,
}: {
  source: SessionStatusBarSource;
  onSelect: (next: SessionStatusBarSource) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const label = (id: SessionStatusBarSource) => t(`tasks.sessionPanel.statusBar.source.${id}`);
  return (
    <div className={className}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="flex size-5 items-center justify-center rounded-sm text-[var(--xterm-fg)] opacity-50 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
              aria-label={t('tasks.sessionPanel.statusBar.switchSource')}
              title={t('tasks.sessionPanel.statusBar.switchSource')}
            >
              <ChevronDown className="size-3" />
            </button>
          }
        />
        <PopoverContent align="start" side="top" className="w-48 gap-0 p-1">
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
