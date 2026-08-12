import {
  ChevronDown,
  ListTree,
  Loader2,
  MessageSquare,
  Minus,
  MoreHorizontal,
  Plus,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClaudeSessionPrompt, Conversation } from '@shared/conversations';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { displaySessionPromptText } from '@renderer/features/tasks/context-panel-prompt-display';
import { useSessionPrompts } from '@renderer/features/tasks/session-info-panel';
import { buildPromptPreviewItems } from '@renderer/features/tasks/session-prompts-preview';
import { useRequireProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { toast } from '@renderer/lib/hooks/use-toast';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@renderer/lib/ui/popover';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { log } from '@renderer/utils/logger';
import { cn } from '@renderer/utils/utils';
import { SessionPromptRestoreButton } from './session-prompt-restore-button';
import { countSessionPromptTreeNodes, SessionPromptTreeView } from './session-prompt-tree';
import { reopenArchivedConversation } from './use-archived-conversations';
import { useConversationPromptRestore } from './use-conversation-prompt-restore';
import { useSessionPromptTree } from './use-session-prompt-tree';

/**
 * The active conversation's prompt history rendered as a scrollable list, oldest
 * at top and newest at bottom (pinned while new prompts stream in, unless the
 * user scrolled up). Shared between the bottom-drawer's full panel and the
 * docked strip so the row shows identically in both surfaces.
 */
export const SessionPromptList = observer(function SessionPromptList({
  prompts,
  onRestorePrompt,
  restoringPromptId,
  className,
  style,
}: {
  prompts: ClaudeSessionPrompt[];
  onRestorePrompt?: (prompt: ClaudeSessionPrompt, index: number) => void;
  restoringPromptId?: string | null;
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
      {prompts.map((prompt, index) => (
        <SessionPromptRow
          key={prompt.id || `prompt-${index}`}
          prompts={prompts}
          prompt={prompt}
          index={index + 1}
          onRestore={onRestorePrompt}
          restoringPromptId={restoringPromptId}
        />
      ))}
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

  return (
    <SessionPromptList
      prompts={prompts.prompts}
      onRestorePrompt={prompts.requestRestorePrompt}
      restoringPromptId={prompts.restoringPromptId}
      className="h-full"
    />
  );
});

const MIN_DOCK_ROWS = 1;
const MAX_DOCK_ROWS = 20;
const DOCK_PROMPT_HEAD_COUNT = 1;

/**
 * The same prompt history docked at the bottom of the conversation pane, gated
 * behind the `interface.dockSessionHistory` setting (toggled from the context
 * popover). Shows the first prompt and N latest prompts — adjustable inline
 * via the header. The action menu opens the complete branch tree in a separate
 * floating panel, while collapsing stops the current-path background fetch.
 */
export const DockedSessionHistory = observer(function DockedSessionHistory({
  active = true,
}: {
  /** Starts cold transcript reads only after the owning terminal has painted. */
  active?: boolean;
}) {
  const { t } = useTranslation();
  const { value: ui, update } = useAppSettingsKey('interface');
  const enabled = ui?.dockSessionHistory ?? true;
  const rows = Math.min(MAX_DOCK_ROWS, Math.max(MIN_DOCK_ROWS, ui?.dockSessionHistoryRows ?? 3));
  const [collapsed, setCollapsed] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
  const prompts = useSessionPrompts(active && enabled && !collapsed);
  const promptTree = useSessionPromptTree(enabled && treeOpen);
  const { restoringPrompt, requestRestorePrompt } = useConversationPromptRestore();
  const provisionedTask = useRequireProvisionedTask();

  if (!enabled || !prompts.hasConversation) return null;

  const setRows = (next: number) =>
    update({ dockSessionHistoryRows: Math.min(MAX_DOCK_ROWS, Math.max(MIN_DOCK_ROWS, next)) });

  const openConversation = async (conversation: Conversation): Promise<boolean> => {
    if (provisionedTask.conversations.conversations.has(conversation.id)) {
      provisionedTask.taskView.tabManager.openConversation(conversation.id);
      provisionedTask.taskView.setFocusedRegion('main');
      return true;
    }
    try {
      await reopenArchivedConversation(conversation);
      provisionedTask.taskView.setFocusedRegion('main');
      return true;
    } catch (error) {
      log.warn('DockedSessionHistory: failed to open archived branch', {
        conversationId: conversation.id,
        error,
      });
      toast({
        title: t('tasks.bottomPanel.sessionOpenBranchFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
        debugInfo: error,
      });
      return false;
    }
  };

  const openTreeConversation = async (conversation: Conversation) => {
    if (await openConversation(conversation)) setTreeOpen(false);
  };

  const restoreTreePrompt: typeof requestRestorePrompt = (location) => {
    setTreeOpen(false);
    requestRestorePrompt(location);
  };

  const treePromptCount = countSessionPromptTreeNodes(promptTree.tree);
  const treeConversationCount = promptTree.tree?.lineageConversations.length ?? 0;

  return (
    <Popover open={treeOpen} onOpenChange={setTreeOpen}>
      <div className="flex shrink-0 flex-col border-t border-border-primary/60 bg-background">
        <div className="flex h-7 shrink-0 items-center gap-1.5 px-3 text-foreground-passive">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left transition-colors hover:text-foreground"
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
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                className="flex size-4 items-center justify-center rounded-sm transition-colors hover:bg-background-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                onClick={() => setRows(rows - 1)}
                disabled={rows <= MIN_DOCK_ROWS}
                aria-label={t('tasks.bottomPanel.sessionFewerRows')}
                title={t('tasks.bottomPanel.sessionFewerRows')}
              >
                <Minus className="size-2.5" />
              </button>
              <span className="w-3 text-center font-mono text-[10px] tabular-nums">{rows}</span>
              <button
                type="button"
                className="flex size-4 items-center justify-center rounded-sm transition-colors hover:bg-background-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                onClick={() => setRows(rows + 1)}
                disabled={rows >= MAX_DOCK_ROWS}
                aria-label={t('tasks.bottomPanel.sessionMoreRows')}
                title={t('tasks.bottomPanel.sessionMoreRows')}
              >
                <Plus className="size-2.5" />
              </button>
            </div>
          ) : null}
          <PopoverTrigger
            type="button"
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded-sm transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border',
              treeOpen && 'bg-background-2 text-foreground'
            )}
            aria-label={t('tasks.bottomPanel.sessionViewTree')}
            title={t('tasks.bottomPanel.sessionViewTree')}
          >
            <ListTree className="size-3" />
          </PopoverTrigger>
        </div>
        {!collapsed ? (
          prompts.hasPrompts ? (
            <DockedSessionPromptPreview
              prompts={prompts.prompts}
              tailCount={rows}
              onOpenAll={prompts.openPromptsModal}
              onRestorePrompt={prompts.requestRestorePrompt}
              restoringPromptId={prompts.restoringPromptId}
            />
          ) : (
            <div className="px-3 pb-2 text-xs text-foreground-passive">
              {t('tasks.panel.noPrompts')}
            </div>
          )
        ) : null}
        <PopoverContent
          align="end"
          side="top"
          sideOffset={6}
          className="w-[min(44rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0"
        >
          <PopoverHeader className="border-b border-border-primary/60 px-3 py-2.5">
            <div className="flex min-w-0 items-start gap-3">
              <div className="min-w-0 flex-1">
                <PopoverTitle className="text-xs font-medium">
                  {t('tasks.bottomPanel.sessionTreeTitle')}
                </PopoverTitle>
                <PopoverDescription className="mt-0.5 text-[11px] leading-4">
                  {t(
                    promptTree.tree && treeConversationCount <= 1
                      ? 'tasks.bottomPanel.sessionTreeSingleConversationDescription'
                      : 'tasks.bottomPanel.sessionTreeDescription'
                  )}
                </PopoverDescription>
              </div>
              <PopoverClose
                className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
                aria-label={t('common.close')}
              >
                {t('common.close')}
              </PopoverClose>
            </div>
            {promptTree.tree ? (
              <span className="font-mono text-[10px] tabular-nums text-foreground-passive">
                {t('tasks.bottomPanel.sessionTreeSummary', {
                  promptCount: treePromptCount,
                  conversationCount: treeConversationCount,
                })}
              </span>
            ) : null}
          </PopoverHeader>
          <div className="min-h-24 bg-background">
            {promptTree.tree ? (
              <SessionPromptTreeView
                tree={promptTree.tree}
                isLoading={promptTree.isLoading}
                activeConversationIds={promptTree.activeConversationIds}
                restoringPrompt={restoringPrompt}
                maxHeight="min(60vh, 32rem)"
                onRestorePrompt={restoreTreePrompt}
                onOpenConversation={openTreeConversation}
              />
            ) : promptTree.isLoading ? (
              <div className="flex h-24 items-center justify-center gap-1.5 text-xs text-foreground-passive">
                <Loader2 className="size-3 animate-spin" />
                {t('common.loading')}
              </div>
            ) : (
              <div className="flex h-24 items-center justify-center px-3 text-xs text-foreground-passive">
                {t('tasks.panel.noPrompts')}
              </div>
            )}
          </div>
        </PopoverContent>
      </div>
    </Popover>
  );
});

function DockedSessionPromptPreview({
  prompts,
  tailCount,
  onOpenAll,
  onRestorePrompt,
  restoringPromptId,
}: {
  prompts: ClaudeSessionPrompt[];
  tailCount: number;
  onOpenAll: () => void;
  onRestorePrompt: (prompt: ClaudeSessionPrompt, index: number) => void;
  restoringPromptId: string | null;
}) {
  const { t } = useTranslation();
  const previewItems = useMemo(
    () => buildPromptPreviewItems(prompts, DOCK_PROMPT_HEAD_COUNT, tailCount),
    [prompts, tailCount]
  );

  return (
    <div className="py-1">
      {previewItems.map((item) =>
        item.type === 'truncated' ? (
          <button
            key="truncated"
            type="button"
            className="flex h-6 w-full min-w-0 items-center justify-center gap-1.5 px-3 text-[11px] text-foreground-passive transition-colors hover:bg-background-1 hover:text-foreground-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
            onClick={onOpenAll}
            aria-label={t('tasks.sessionInfo.viewAllPrompts')}
            title={t('tasks.sessionInfo.viewAllPrompts')}
          >
            <MoreHorizontal className="size-3.5" />
            <span>{t('tasks.sessionInfo.truncatedPrompts', { count: item.hiddenCount })}</span>
          </button>
        ) : (
          <SessionPromptRow
            key={item.prompt.id || `prompt-${item.promptIndex}`}
            prompts={prompts}
            prompt={item.prompt}
            index={item.promptIndex}
            onRestore={onRestorePrompt}
            restoringPromptId={restoringPromptId}
          />
        )
      )}
    </div>
  );
}

function SessionPromptRow({
  prompts,
  prompt,
  index,
  onClick,
  onRestore,
  restoringPromptId,
}: {
  prompts: ClaudeSessionPrompt[];
  prompt: ClaudeSessionPrompt;
  index: number;
  onClick?: () => void;
  onRestore?: (prompt: ClaudeSessionPrompt, index: number) => void;
  restoringPromptId?: string | null;
}) {
  const { t } = useTranslation();
  const text = displaySessionPromptText(prompt.text).trim();
  const promptDate = parsePromptTimestamp(prompt.timestamp);
  const timestamp = promptDate?.toLocaleTimeString() ?? null;
  const canRestore = Boolean(onRestore && prompt.restoreTarget);
  const [selectedPromptId, setSelectedPromptId] = useState(prompt.id);
  const selectedPrompt = prompts.find((item) => item.id === selectedPromptId) ?? prompt;
  const selectedPromptIndex = prompts.findIndex((item) => item.id === selectedPrompt.id);
  const selectedIndex = selectedPromptIndex >= 0 ? selectedPromptIndex + 1 : index;
  const selectedText = displaySessionPromptText(selectedPrompt.text).trim();
  const selectedPromptDate = parsePromptTimestamp(selectedPrompt.timestamp);
  const selectedCanRestore = Boolean(onRestore && selectedPrompt.restoreTarget);
  const selectedIsRestoring = restoringPromptId === selectedPrompt.id;
  const promptLengths = prompts.map((item) => displaySessionPromptText(item.text).trim().length);
  const maxPromptLength = Math.max(1, ...promptLengths);
  const handleClick =
    onClick ?? (canRestore && onRestore ? () => onRestore(prompt, index) : undefined);
  const className = 'flex h-6 min-w-0 flex-1 items-center gap-2 text-left';

  const content = (
    <>
      <span className="w-6 shrink-0 text-right font-mono text-[10px] text-foreground-passive">
        {index}
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="min-w-0 flex-1 truncate text-xs leading-5 text-foreground-muted" />
          }
        >
          {text}
        </TooltipTrigger>
        <TooltipContent
          align="start"
          showArrow={false}
          className="block w-[min(28rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border-primary/70 bg-background-quaternary p-0 text-foreground shadow-lg"
        >
          <div data-session-prompt-preview className="flex min-w-0">
            <aside
              data-session-prompt-history-bars
              className="flex w-14 shrink-0 items-center justify-center border-r border-border-primary/60 bg-background-1/55 px-2 py-3"
            >
              <div className="flex max-h-60 w-9 flex-col items-center gap-1.5 overflow-y-auto rounded-full border border-border-primary/45 bg-background px-1.5 py-2 shadow-sm">
                {prompts.map((historyPrompt, historyIndex) => {
                  const isSelected = historyPrompt.id === selectedPrompt.id;
                  const historyPromptLength = promptLengths[historyIndex] ?? 0;
                  const barWidth = promptBarWidth(historyPromptLength, maxPromptLength);
                  const promptLabel = t('tasks.sessionInfo.userMessageIndex', {
                    index: historyIndex + 1,
                  });

                  return (
                    <button
                      key={historyPrompt.id || `history-prompt-${historyIndex}`}
                      type="button"
                      className="group flex h-3 w-full shrink-0 items-center justify-center rounded-full transition-colors hover:bg-background-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
                      aria-label={promptLabel}
                      aria-pressed={isSelected}
                      data-session-prompt-history-bar={historyIndex + 1}
                      data-session-prompt-history-bar-active={isSelected ? 'true' : 'false'}
                      title={promptLabel}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedPromptId(historyPrompt.id);
                      }}
                    >
                      <span
                        className={cn(
                          'block h-0.5 max-w-full rounded-full transition-colors',
                          isSelected
                            ? 'bg-foreground'
                            : 'bg-foreground-passive/45 group-hover:bg-foreground-muted'
                        )}
                        style={{ width: `${barWidth}%` }}
                      />
                    </button>
                  );
                })}
              </div>
            </aside>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2 border-b border-border-primary/60 px-3 py-2">
                <span className="text-[10px] font-medium text-foreground-passive">
                  {t('tasks.sessionInfo.createdAt')}
                </span>
                {selectedPromptDate ? (
                  <RelativeTime
                    value={selectedPromptDate}
                    className="font-mono text-[11px] tabular-nums text-foreground-muted"
                  />
                ) : (
                  <span className="font-mono text-[11px] text-foreground-passive">—</span>
                )}
                {selectedCanRestore && onRestore ? (
                  <SessionPromptRestoreButton
                    prompt={selectedPrompt}
                    index={selectedIndex}
                    isRestoring={selectedIsRestoring}
                    onRestore={onRestore}
                    visibleLabel={t('tasks.bottomPanel.sessionBranchFromHere')}
                    className="ml-auto h-auto min-h-7 shrink-0 justify-start rounded-md border border-primary/35 bg-primary/10 px-2.5 py-1.5 text-left text-[11px] font-medium text-primary shadow-sm hover:bg-primary/15 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/60"
                  />
                ) : null}
              </div>
              <div className="max-h-52 overflow-y-auto px-3 py-2.5">
                <p className="whitespace-pre-wrap break-words text-left text-xs leading-5 text-foreground">
                  {selectedText || '—'}
                </p>
              </div>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
      {timestamp && !canRestore ? (
        <span className="shrink-0 font-mono text-[10px] text-foreground-passive opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {timestamp}
        </span>
      ) : null}
    </>
  );

  return (
    <div className="group flex h-6 w-full min-w-0 items-center gap-1 px-3 transition-colors hover:bg-background-1 focus-within:bg-background-1">
      {handleClick ? (
        <button
          type="button"
          className={cn(
            className,
            'hover:text-foreground-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border'
          )}
          onClick={handleClick}
        >
          {content}
        </button>
      ) : (
        <div className={className}>{content}</div>
      )}
    </div>
  );
}

function parsePromptTimestamp(timestamp: string | null): Date | null {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

function promptBarWidth(promptLength: number, maxPromptLength: number): number {
  if (promptLength <= 0) return 30;
  const ratio = Math.sqrt(promptLength / maxPromptLength);
  return Math.round(30 + ratio * 58);
}
