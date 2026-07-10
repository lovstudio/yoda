import { Terminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { getRuntime, isValidRuntimeId, type RuntimeId } from '@shared/runtime-registry';
import { tokenBreakdownTitle } from '@renderer/features/tasks/components/task-stats-strip';
import { useTaskStats } from '@renderer/features/tasks/hooks/useTaskStats';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { appState } from '@renderer/lib/stores/app-state';
import { workspaceShellStore } from '@renderer/lib/stores/workspace-shell-store';
import { formatCompactNumber } from '@renderer/utils/format-compact-number';
import { cn } from '@renderer/utils/utils';

export function explicitConversationRuntimeId(value: unknown): RuntimeId | null {
  return typeof value === 'string' && isValidRuntimeId(value) ? value : null;
}

export const WorkspaceRuntimeBar = observer(function WorkspaceRuntimeBar() {
  const { t } = useTranslation();
  const route = appState.navigation.currentViewId;
  const params = appState.navigation.viewParamsStore[route] as
    | { projectId?: string; taskId?: string }
    | undefined;
  const provisionedTask =
    route === 'task' && params?.projectId && params.taskId
      ? asProvisioned(getTaskStore(params.projectId, params.taskId))
      : undefined;
  const runtimeId = explicitConversationRuntimeId(
    provisionedTask?.taskView.tabManager.activeConversation?.data.runtimeId
  );
  const runtime = runtimeId ? getRuntime(runtimeId) : null;
  const activeConversationId = provisionedTask?.taskView.tabManager.activeConversationId;
  const { data: taskStats } = useTaskStats(params?.projectId ?? '', params?.taskId ?? '', {
    enabled: Boolean(
      route === 'task' && params?.projectId && params.taskId && activeConversationId
    ),
  });
  const sessionTokens =
    route === 'task' && activeConversationId
      ? (taskStats?.conversations.find((item) => item.conversationId === activeConversationId)
          ?.tokens ?? null)
      : null;
  const connectionId = provisionedTask?.workspace.sshConnectionId;
  const dependency = runtimeId
    ? connectionId
      ? appState.dependencies.getRemote(connectionId).data?.[runtimeId]
      : appState.dependencies.agentStatuses[runtimeId]
    : undefined;
  const taskTerminalActive = Boolean(
    provisionedTask?.taskView.isTerminalDrawerOpen &&
      provisionedTask.taskView.activeBottomPanelTab === 'terminals'
  );
  const terminalActive = provisionedTask ? taskTerminalActive : workspaceShellStore.isShellOpen;

  const toggleTerminal = () => {
    if (provisionedTask) {
      if (workspaceShellStore.isOpen) workspaceShellStore.close();
      if (taskTerminalActive) {
        provisionedTask.taskView.setTerminalDrawerOpen(false);
        return;
      }
      provisionedTask.taskView.setBottomPanelTab('terminals');
      provisionedTask.taskView.setTerminalDrawerOpen(true);
      provisionedTask.taskView.setFocusedRegion('bottom');
      return;
    }
    void workspaceShellStore.toggleShell().catch(() => {});
  };

  return (
    <div className="flex h-7 shrink-0 items-center gap-2 border-t border-border bg-background-secondary px-2 text-[11px] text-foreground-muted">
      {runtimeId ? (
        <div
          className="flex min-w-0 items-center gap-1.5"
          title={t('workspaceRuntime.currentSessionTitle', {
            name: runtime?.name ?? runtimeId,
          })}
        >
          <span
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              dependency?.status === 'available'
                ? 'bg-emerald-500'
                : dependency
                  ? 'bg-amber-500'
                  : 'bg-foreground-muted/40'
            )}
          />
          <span className="shrink-0">{t('workspaceRuntime.currentSession')}</span>
          <span aria-hidden>·</span>
          <span className="truncate text-foreground">{runtime?.name ?? runtimeId}</span>
          {dependency?.version ? (
            <span className="shrink-0 tabular-nums">v{dependency.version}</span>
          ) : null}
          {sessionTokens ? (
            <>
              <span aria-hidden>·</span>
              <span
                className="shrink-0 rounded border border-border/70 bg-background px-1 py-0.5 text-foreground-passive"
                title={tokenBreakdownTitle(sessionTokens, t)}
              >
                {t('workspaceRuntime.contextUsage', {
                  tokens: formatCompactNumber(sessionTokens.total),
                })}
              </span>
            </>
          ) : null}
        </div>
      ) : null}
      <span className="flex-1" />
      <button
        type="button"
        title={t('workspaceRuntime.terminal')}
        aria-label={t('workspaceRuntime.terminal')}
        aria-pressed={terminalActive}
        onClick={toggleTerminal}
        className={cn(
          'flex h-5 items-center gap-1 rounded px-1.5 transition-colors hover:bg-background-2 hover:text-foreground',
          terminalActive && 'bg-background-2 text-foreground'
        )}
      >
        <Terminal className="size-3.5" />
        <span>{t('workspaceRuntime.terminal')}</span>
      </button>
    </div>
  );
});
