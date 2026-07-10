import { PanelRightOpen, RefreshCw, Settings2, SquareTerminal, Terminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getRuntime, isValidRuntimeId, type RuntimeId } from '@shared/runtime-registry';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { openTaskTerminal } from '@renderer/features/tasks/open-task-terminal';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { workspaceShellStore } from '@renderer/lib/stores/workspace-shell-store';
import { cn } from '@renderer/utils/utils';

const FALLBACK_RUNTIME: RuntimeId = 'codex';

export const WorkspaceRuntimeBar = observer(function WorkspaceRuntimeBar() {
  const { t } = useTranslation();
  const { value: defaultRuntimeValue } = useAppSettingsKey('defaultRuntime');
  const { toggleLeft } = useWorkspaceLayoutContext();
  const [refreshing, setRefreshing] = useState(false);
  const route = appState.navigation.currentViewId;
  const params = appState.navigation.viewParamsStore[route] as
    | { projectId?: string; taskId?: string }
    | undefined;
  const provisionedTask =
    route === 'task' && params?.projectId && params.taskId
      ? asProvisioned(getTaskStore(params.projectId, params.taskId))
      : undefined;
  const defaultRuntime = isValidRuntimeId(defaultRuntimeValue)
    ? defaultRuntimeValue
    : FALLBACK_RUNTIME;
  const runtimeId =
    provisionedTask?.taskView.tabManager.activeConversation?.data.runtimeId ?? defaultRuntime;
  const runtime = getRuntime(runtimeId);
  const dependency = appState.dependencies.agentStatuses[runtimeId];
  const canOpenTaskTerminal = Boolean(provisionedTask);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await appState.dependencies.refreshAgents();
    } finally {
      setRefreshing(false);
    }
  };

  const manageRuntime = () => {
    appState.sidePane.pinView('settings', { tab: 'clis-models', runtimeId });
  };

  return (
    <div className="flex h-7 shrink-0 items-center gap-1 border-t border-border bg-background-secondary px-1.5 text-[11px] text-foreground-muted">
      <BarButton title={t('navigation.toggleLeftSidebar')} onClick={toggleLeft}>
        <PanelRightOpen className="size-3.5 rotate-180" />
      </BarButton>
      <button
        type="button"
        onClick={manageRuntime}
        className="flex min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-background-2 hover:text-foreground"
        title={t('workspaceRuntime.manage')}
      >
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            dependency?.status === 'available' ? 'bg-emerald-500' : 'bg-amber-500'
          )}
        />
        <span className="truncate">{runtime?.name ?? runtimeId}</span>
        {dependency?.version ? <span className="tabular-nums">v{dependency.version}</span> : null}
      </button>
      <BarButton title={t('workspaceRuntime.refresh')} onClick={() => void refresh()}>
        <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
      </BarButton>
      <span className="flex-1" />
      {canOpenTaskTerminal ? (
        <BarButton
          title={t('workspaceRuntime.taskTerminal')}
          onClick={() => {
            if (params?.projectId && params.taskId)
              openTaskTerminal(params.projectId, params.taskId);
          }}
        >
          <Terminal className="size-3.5" />
          <span>{t('workspaceRuntime.taskTerminal')}</span>
        </BarButton>
      ) : null}
      <BarButton
        title={t('workspaceRuntime.openRuntime', { name: runtime?.name ?? runtimeId })}
        onClick={() => {
          void workspaceShellStore.runRuntimeAction(runtimeId, 'open').catch(() => {});
        }}
      >
        <SquareTerminal className="size-3.5" />
        <span>{t('workspaceRuntime.cli')}</span>
      </BarButton>
      <BarButton title={t('workspaceRuntime.manage')} onClick={manageRuntime}>
        <Settings2 className="size-3.5" />
      </BarButton>
    </div>
  );
});

function BarButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-5 items-center gap-1 rounded px-1.5 hover:bg-background-2 hover:text-foreground"
    >
      {children}
    </button>
  );
}
