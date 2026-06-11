import { MessageSquare } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { displaySessionPromptText } from '@renderer/features/tasks/context-panel-prompt-display';
import { useSessionPrompts } from '@renderer/features/tasks/session-info-panel';
import { EmptyState } from '@renderer/lib/ui/empty-state';

/**
 * Bottom-drawer tab: the active conversation's prompt history as a full
 * scrollable list, oldest at top, newest at bottom (pinned while new prompts
 * stream in). Only fetches while visible.
 */
export const SessionHistoryPanel = observer(function SessionHistoryPanel({
  active,
}: {
  active: boolean;
}) {
  const { t } = useTranslation();
  const prompts = useSessionPrompts(active);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottomRef = useRef(true);

  // Keep the newest prompt in view unless the user scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [prompts.prompts.length, active]);

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

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto py-1"
      onScroll={(e) => {
        const el = e.currentTarget;
        pinnedToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
    >
      {prompts.prompts.map((prompt, index) => {
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
