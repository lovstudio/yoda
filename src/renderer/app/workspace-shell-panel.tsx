import { X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { getRuntime } from '@shared/runtime-registry';
import { WorkspaceShellTerminal } from '@renderer/features/tasks/terminals/workspace-shell-terminal';
import { workspaceShellStore } from '@renderer/lib/stores/workspace-shell-store';
import { Button } from '@renderer/lib/ui/button';

export const WorkspaceShellPanel = observer(function WorkspaceShellPanel() {
  const { t } = useTranslation();
  const runtimeName = workspaceShellStore.runtimeId
    ? (getRuntime(workspaceShellStore.runtimeId)?.name ?? workspaceShellStore.runtimeId)
    : null;
  const title =
    workspaceShellStore.mode === 'command' && workspaceShellStore.commandLabel
      ? t('workspaceRuntime.quickAction', { label: workspaceShellStore.commandLabel })
      : workspaceShellStore.mode === 'runtime-action' &&
          workspaceShellStore.runtimeAction &&
          runtimeName
        ? t(`workspaceRuntime.actions.${workspaceShellStore.runtimeAction}`, { name: runtimeName })
        : t('workspaceRuntime.terminal');
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-background-secondary px-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{title}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          title={t('common.close')}
          onClick={() => workspaceShellStore.close()}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <WorkspaceShellTerminal active={workspaceShellStore.isOpen} paneId="workspace-shell" />
    </div>
  );
});
