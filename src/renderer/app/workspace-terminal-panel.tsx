import { Plus, Terminal, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { TerminalLogContextMenu } from '@renderer/features/tasks/terminals/terminal-log-context-menu';
import { TerminalWorkbench } from '@renderer/features/tasks/terminals/terminal-workbench';
import { useDefaultWorkspaceFileLinks } from '@renderer/features/tasks/terminals/use-workspace-file-links';
import { workspaceTerminalStore } from '@renderer/lib/stores/workspace-terminal-store';

const ICON_BUTTON_CLASS =
  'flex size-5 shrink-0 items-center justify-center rounded-sm text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border';

export const WorkspaceTerminalPanel = observer(function WorkspaceTerminalPanel() {
  const { t } = useTranslation();
  const manager = workspaceTerminalStore.manager;
  const tabs = workspaceTerminalStore.tabs;
  const projectStore = workspaceTerminalStore.activeProjectId
    ? getProjectStore(workspaceTerminalStore.activeProjectId)
    : undefined;
  const project = projectStore ? asMounted(projectStore) : undefined;
  const remoteConnectionId = project?.data.type === 'ssh' ? project.data.connectionId : undefined;
  const fileLinks = useDefaultWorkspaceFileLinks(
    workspaceTerminalStore.activeProjectId,
    project?.data.path,
    remoteConnectionId
  );

  if (!manager || !tabs) return null;

  const activeTerminal = tabs.tabs.find((tab) => tab.data.id === tabs.activeTabId) ?? null;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background text-foreground">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border px-2">
        <TerminalLogContextMenu terminal={activeTerminal}>
          <div className="flex h-5 shrink-0 items-center gap-1 rounded-sm bg-background-2 px-1.5 text-[11px] text-foreground">
            <Terminal className="size-3" />
            <span>{t('tasks.bottomPanel.terminals')}</span>
            {projectStore ? (
              <>
                <span aria-hidden className="text-foreground-muted">
                  ·
                </span>
                <span className="max-w-40 truncate" title={projectStore.displayName}>
                  {projectStore.displayName}
                </span>
              </>
            ) : null}
          </div>
        </TerminalLogContextMenu>
        <button
          type="button"
          className={ICON_BUTTON_CLASS}
          onClick={() => void workspaceTerminalStore.createTerminal()}
          aria-label={t('tasks.terminals.newTerminal')}
          title={t('tasks.terminals.newTerminal')}
        >
          <Plus className="size-3" />
        </button>
        <button
          type="button"
          className={`${ICON_BUTTON_CLASS} ml-auto`}
          onClick={() => workspaceTerminalStore.close()}
          aria-label={t('common.close')}
          title={t('common.close')}
        >
          <X className="size-3" />
        </button>
      </div>
      {workspaceTerminalStore.error ? (
        <p className="shrink-0 border-b border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
          {workspaceTerminalStore.error}
        </p>
      ) : null}
      <div className="min-h-0 flex-1">
        <TerminalWorkbench
          terminalMgr={manager}
          terminalTabView={tabs}
          paneId="workspace-terminal"
          layoutId={`workspace-terminal:${manager.projectId}:${manager.taskId}`}
          visible={workspaceTerminalStore.isOpen}
          autoFocus={workspaceTerminalStore.isOpen}
          remoteConnectionId={remoteConnectionId}
          fileLinks={fileLinks}
          webLinks={null}
          onCreateTerminal={() => workspaceTerminalStore.createTerminal()}
          onFocus={() => {}}
        />
      </div>
    </div>
  );
});
