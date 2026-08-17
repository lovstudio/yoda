import { Brain, Minimize2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  WORKSPACE_BAR_CARD_CLASS,
  WorkspaceBarCardHeader,
  WorkspaceBarCardMenu,
  WorkspaceBarCardRow,
  WorkspaceBarCardSection,
} from '@renderer/app/workspace-bar-card';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { LatestReplyScreenshotButton } from '@renderer/features/tasks/conversations/latest-reply-screenshot';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { DropdownMenuItem, DropdownMenuSeparator } from '@renderer/lib/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { Switch } from '@renderer/lib/ui/switch';
import { formatCompactNumber } from '@renderer/utils/format-compact-number';
import { cn } from '@renderer/utils/utils';
import {
  ContextProgressBar,
  RUNTIME_BAR_METRIC_ACTION_CLASS,
  RUNTIME_BAR_METRIC_LABEL_CLASS,
  RuntimeBarSeparator,
  RuntimeMetricRow,
} from '../bar-chrome';
import { formatPopoverTime } from '../display';
import { useRuntimeBarSession } from '../session-context';
import { useRuntimeBarSessionUsage } from '../session-usage';

/**
 * How much of the session's context window is spent. Absent until the runtime
 * has actually reported a window — an unknown limit is not a full one.
 */
export const RuntimeBarContextItem = observer(function RuntimeBarContextItem() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isCompacting, setIsCompacting] = useState(false);
  const { value: interfaceSettings, update: updateInterfaceSettings } =
    useAppSettingsKey('interface');
  const { runtimeId, activeProjectId, activeTaskId, activeConversationId } = useRuntimeBarSession();
  const { sessionTokens, sessionContext, contextPercent, contextRemaining, contextTone } =
    useRuntimeBarSessionUsage();

  const sessionHistoryDocked = interfaceSettings?.dockSessionHistory ?? true;
  const toggleSessionHistoryDock = () => {
    updateInterfaceSettings({ dockSessionHistory: !sessionHistoryDocked });
  };
  const canCompactContext = Boolean(
    runtimeId === 'codex' && activeProjectId && activeTaskId && activeConversationId
  );
  const canCaptureLatestReply = Boolean(activeProjectId && activeTaskId && activeConversationId);

  const compactContext = async () => {
    if (
      !canCompactContext ||
      !activeProjectId ||
      !activeTaskId ||
      !activeConversationId ||
      !runtimeId
    ) {
      toast.error(t('workspaceRuntime.compactContextUnavailable'));
      return;
    }
    setIsCompacting(true);
    try {
      const injected = await rpc.conversations.injectConversationPrompt({
        projectId: activeProjectId,
        taskId: activeTaskId,
        conversationId: activeConversationId,
        runtime: runtimeId,
        prompt: '/compact',
      });
      if (!injected) {
        toast.error(t('workspaceRuntime.compactContextUnavailable'));
        return;
      }
      toast.success(t('workspaceRuntime.compactContextStarted'));
    } catch {
      toast.error(t('workspaceRuntime.compactContextUnavailable'));
    } finally {
      setIsCompacting(false);
    }
  };

  if (!sessionContext || contextPercent == null) return null;

  const contextTitle = [
    t('workspaceRuntime.contextUsageTitle', {
      used: formatCompactNumber(sessionContext.usedTokens),
      limit: formatCompactNumber(sessionContext.limitTokens),
      percent: contextPercent,
    }),
    ...(sessionTokens
      ? [
          t('workspaceRuntime.sessionTokenTotal', {
            tokens: formatCompactNumber(sessionTokens.total),
          }),
        ]
      : []),
    ...(sessionContext.resetCount > 0
      ? [
          t('workspaceRuntime.contextResets', { count: sessionContext.resetCount }),
          ...(sessionContext.lastResetAt
            ? [
                t('workspaceRuntime.contextLastReset', {
                  time: formatPopoverTime(sessionContext.lastResetAt),
                }),
              ]
            : []),
        ]
      : []),
  ].join('\n');

  return (
    <>
      <RuntimeBarSeparator />
      <Popover>
        <PopoverTrigger
          aria-label={t('workspaceRuntime.contextUsage', {
            used: formatCompactNumber(sessionContext.usedTokens),
            limit: formatCompactNumber(sessionContext.limitTokens),
            percent: contextPercent,
          })}
          className={cn(RUNTIME_BAR_METRIC_ACTION_CLASS, 'shrink-0 text-foreground-passive')}
          title={contextTitle}
        >
          <Brain className="size-3.5" />
          <span className={RUNTIME_BAR_METRIC_LABEL_CLASS}>
            {t('workspaceRuntime.contextUsageShort')}
          </span>
          <ContextProgressBar percent={contextPercent} tone={contextTone} compact />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="top"
          sideOffset={8}
          className={cn(WORKSPACE_BAR_CARD_CLASS, 'w-72 max-w-[calc(100vw-1rem)]')}
        >
          <WorkspaceBarCardHeader
            icon={Brain}
            title={t('workspaceRuntime.contextPopoverTitle')}
            description={t('workspaceRuntime.contextPopoverDescription')}
            actions={
              canCaptureLatestReply || canCompactContext ? (
                <WorkspaceBarCardMenu>
                  {activeConversationId && activeProjectId && activeTaskId ? (
                    <LatestReplyScreenshotButton
                      projectId={activeProjectId}
                      taskId={activeTaskId}
                      conversationId={activeConversationId}
                      presentation="menu-item"
                    />
                  ) : null}
                  {canCaptureLatestReply && canCompactContext ? <DropdownMenuSeparator /> : null}
                  {canCompactContext ? (
                    <DropdownMenuItem disabled={isCompacting} onClick={() => void compactContext()}>
                      <Minimize2 className={isCompacting ? 'animate-pulse' : undefined} />
                      {isCompacting
                        ? t('workspaceRuntime.compactingContext')
                        : t('workspaceRuntime.compactContext')}
                    </DropdownMenuItem>
                  ) : null}
                </WorkspaceBarCardMenu>
              ) : null
            }
          />
          <WorkspaceBarCardSection className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-mono tabular-nums text-foreground">
                {formatCompactNumber(sessionContext.usedTokens)} /{' '}
                {formatCompactNumber(sessionContext.limitTokens)}
              </span>
              <span className="font-mono tabular-nums text-foreground">{contextPercent}%</span>
            </div>
            <ContextProgressBar percent={contextPercent} tone={contextTone} />
            <span className="text-[11px] text-foreground-passive">
              {t('workspaceRuntime.contextRemainingTokens', {
                value: formatCompactNumber(contextRemaining ?? 0),
              })}
            </span>
          </WorkspaceBarCardSection>
          <WorkspaceBarCardSection className="flex flex-col gap-1.5 text-xs">
            <RuntimeMetricRow
              label={t('workspaceRuntime.sessionTokenTotalLabel')}
              value={sessionTokens ? formatCompactNumber(sessionTokens.total) : '—'}
            />
            <RuntimeMetricRow
              label={t('workspaceRuntime.contextCompactionsLabel')}
              value={String(sessionContext.resetCount)}
            />
            {sessionContext.lastResetAt ? (
              <RuntimeMetricRow
                label={t('workspaceRuntime.contextLastCompactionLabel')}
                value={formatPopoverTime(sessionContext.lastResetAt)}
              />
            ) : null}
          </WorkspaceBarCardSection>
          {activeConversationId ? (
            <WorkspaceBarCardSection>
              <WorkspaceBarCardRow
                label={t('workspaceRuntime.sessionHistoryVisibility')}
                description={t('workspaceRuntime.sessionHistoryVisibilityDescription')}
                control={
                  <Switch
                    size="sm"
                    checked={sessionHistoryDocked}
                    onCheckedChange={toggleSessionHistoryDock}
                    aria-label={t('workspaceRuntime.sessionHistoryVisibility')}
                  />
                }
              />
            </WorkspaceBarCardSection>
          ) : null}
        </PopoverContent>
      </Popover>
    </>
  );
});
