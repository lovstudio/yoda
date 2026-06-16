import { ChevronDown, MessageSquare } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClaudeSessionPrompt } from '@shared/conversations';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { displaySessionPromptText } from '@renderer/features/tasks/context-panel-prompt-display';
import { useSessionPrompts } from '@renderer/features/tasks/session-info-panel';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { cn } from '@renderer/utils/utils';

/** Height of one prompt row (h-6) — used to cap the docked list to N rows. */
export const SESSION_PROMPT_ROW_PX = 24;

/**
 * The active conversation's prompt history rendered as a scrollable list, oldest
 * at top and newest at bottom (pinned while new prompts stream in, unless the
 * user scrolled up). Shared between the bottom-drawer's full panel and the
 * docked strip so the row shows identically in both surfaces.
 */
export const SessionPromptList = observer(function SessionPromptList({
  prompts,
  className,
  style,
}: {
  prompts: ClaudeSessionPrompt[];
  className?: string;
  style?: CSSProperties;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottomRef = useRef(true);

  // Keep the newest prompt in view unless the user scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [prompts.length]);

  return (
    <div
      ref={scrollRef}
      className={cn('overflow-y-auto py-1', className)}
      style={style}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinnedToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
    >
      {prompts.map((prompt, index) => {
        const text = displaySessionPromptText(prompt.text).trim();
        const timestamp = prompt.timestamp ? new Date(prompt.timestamp).toLocaleTimeString() : null;
        return (
          <div
            key={prompt.id || `prompt-${index}`}
            className="group flex h-6 w-full min-w-0 items-center gap-2 px-3"
            title={text}
          >
            <span className="w-6 shrink-0 text-right font-mono text-[10px] text-foreground-passive">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs leading-5 text-foreground-muted">
              {text}
            </span>
            {timestamp ? (
              <span className="shrink-0 font-mono text-[10px] text-foreground-passive opacity-0 transition-opacity group-hover:opacity-100">
                {timestamp}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
});

/**
 * Bottom-drawer tab: the active conversation's prompt history as a full
 * scrollable list. Only fetches while visible.
 */
export const SessionHistoryPanel = observer(function SessionHistoryPanel({
  active,
}: {
  active: boolean;
}) {
  const { t } = useTranslation();
  const prompts = useSessionPrompts(active);

  if (!prompts.hasConversation) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<MessageSquare className="h-5 w-5 text-muted-foreground" />}
          label={t('tasks.sessionInfo.noSession')}
          description={t('tasks.sessionInfo.noSessionDescription')}
        />
      </div>
    );
  }

  if (!prompts.hasPrompts) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-foreground-passive">
        {t('tasks.panel.noPrompts')}
      </div>
    );
  }

  return <SessionPromptList prompts={prompts.prompts} className="h-full" />;
});

/**
 * The same prompt history docked at the bottom of the conversation pane, gated
 * behind the `interface.dockSessionHistory` setting. Caps to N visible rows
 * (`interface.dockSessionHistoryRows`) and can be collapsed inline; collapsing
 * also stops the background fetch.
 */
export const DockedSessionHistory = observer(function DockedSessionHistory() {
  const { t } = useTranslation();
  const { value: ui } = useAppSettingsKey('interface');
  const enabled = ui?.dockSessionHistory ?? false;
  const rows = Math.min(20, Math.max(1, ui?.dockSessionHistoryRows ?? 3));
  const [collapsed, setCollapsed] = useState(false);
  const prompts = useSessionPrompts(enabled && !collapsed);

  if (!enabled || !prompts.hasConversation) return null;

  return (
    <div className="flex shrink-0 flex-col border-t border-border-primary/60 bg-background">
      <button
        type="button"
        className="flex h-7 shrink-0 items-center gap-1.5 px-3 text-left text-foreground-passive transition-colors hover:text-foreground"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
      >
        <ChevronDown className={cn('size-3 transition-transform', collapsed && '-rotate-90')} />
        <span className="text-[11px] font-medium">{t('tasks.bottomPanel.session')}</span>
        <span className="font-mono text-[10px] tabular-nums text-foreground-passive">
          {prompts.prompts.length}
        </span>
      </button>
      {!collapsed ? (
        prompts.hasPrompts ? (
          <SessionPromptList
            prompts={prompts.prompts}
            style={{ maxHeight: rows * SESSION_PROMPT_ROW_PX }}
          />
        ) : (
          <div className="px-3 pb-2 text-xs text-foreground-passive">
            {t('tasks.panel.noPrompts')}
          </div>
        )
      ) : null}
    </div>
  );
});
