import { Terminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { workspaceTerminalStore } from '@renderer/lib/stores/workspace-terminal-store';
import { cn } from '@renderer/utils/utils';
import { RUNTIME_BAR_ACTION_CLASS, RUNTIME_BAR_ACTION_LABEL_CLASS } from '../bar-chrome';
import { useRuntimeBarSession } from '../session-context';

/**
 * The project/global Terminal used by quick actions. Task terminals keep their
 * task-local controls and must not become a second state source for this button.
 */
export const RuntimeBarTerminalItem = observer(function RuntimeBarTerminalItem() {
  const { t } = useTranslation();
  const { provisionedTask, activeMountedProjectData } = useRuntimeBarSession();
  const taskTerminalVisible = Boolean(
    provisionedTask?.taskView.isTerminalDrawerOpen &&
      provisionedTask.taskView.activeBottomPanelTab === 'terminals'
  );
  const workspaceTerminalOpen = workspaceTerminalStore.isOpen;
  const terminalActive = workspaceTerminalOpen;

  useEffect(() => {
    void workspaceTerminalStore.syncActiveProject(activeMountedProjectData).catch(() => {});
  }, [activeMountedProjectData]);

  useLayoutEffect(() => {
    // A task drawer can already be open behind the project Terminal. Collapse
    // it before paint so closing a quick-action Terminal cannot reveal an
    // unrelated task Terminal and look like the same button changed sessions.
    if (!workspaceTerminalOpen || !taskTerminalVisible || !provisionedTask) return;
    provisionedTask.taskView.setTerminalDrawerOpen(false);
  }, [provisionedTask, taskTerminalVisible, workspaceTerminalOpen]);

  const toggleTerminal = () => {
    void workspaceTerminalStore.toggleForRuntimeBar(activeMountedProjectData).catch(() => {});
  };

  return (
    <button
      type="button"
      title={t('workspaceRuntime.terminal')}
      aria-label={t('workspaceRuntime.terminal')}
      aria-pressed={terminalActive}
      onClick={toggleTerminal}
      className={cn(RUNTIME_BAR_ACTION_CLASS, terminalActive && 'bg-background-2 text-foreground')}
    >
      <Terminal aria-hidden className="size-3.5" />
      <span className={RUNTIME_BAR_ACTION_LABEL_CLASS}>{t('workspaceRuntime.terminal')}</span>
    </button>
  );
});
