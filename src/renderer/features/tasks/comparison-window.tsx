import { Columns2, PanelRightOpen, Rows2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComparisonWindowTarget } from '@shared/comparison-window';
import { CommandShortcutBinder } from '@renderer/lib/commands/command-shortcut-binder';
import { ErrorBoundary } from '@renderer/lib/components/error-boundary';
import { MonacoKeyboardBridge } from '@renderer/lib/components/monaco-keyboard-bridge';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { rpc } from '@renderer/lib/ipc';
import { ModalRenderer } from '@renderer/lib/modal/modal-renderer';
import { appState } from '@renderer/lib/stores/app-state';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@renderer/lib/ui/resizable';
import { Toaster } from '@renderer/lib/ui/toaster';
import { cn } from '@renderer/utils/utils';
import { SelfContainedTaskPane } from './split-view/tiled-task-grid';
import { getTaskStore } from './stores/task-selectors';

/**
 * Detached window that tiles several compared tasks side by side. Each pane is a
 * fully self-contained task view (its own providers + auto-provision), so this
 * window does not touch navigation or the split-view store — it just maps the
 * launch target's panes. Closing the window leaves every task intact in the main
 * workspace.
 */
export const ComparisonWindow = observer(function ComparisonWindow({
  target,
}: {
  target: ComparisonWindowTarget;
}) {
  useTheme();
  const { t } = useTranslation();
  const [layoutKind, setLayoutKind] = useState<'columns' | 'rows'>(target.layout.kind);

  // Each pane's task lives in its project; mount every distinct project so the
  // SelfContainedTaskPane can resolve its task store and provision it.
  useEffect(() => {
    const projectIds = [...new Set(target.panes.map((pane) => pane.projectId))];
    for (const id of projectIds) {
      void appState.projects.mountProject(id).catch(() => {});
    }
  }, [target]);

  return (
    <>
      <CommandShortcutBinder />
      <MonacoKeyboardBridge />
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-background-secondary pl-20 pr-2 dark:bg-background [-webkit-app-region:drag]">
          <span className="h-3.5 w-px shrink-0 bg-border" aria-hidden />
          <span className="min-w-0 truncate text-xs font-medium text-foreground-muted">
            {t('comparison.title', { count: target.panes.length })}
          </span>
          <div className="ml-auto flex items-center gap-1 [-webkit-app-region:no-drag]">
            <LayoutButton
              active={layoutKind === 'columns'}
              label={t('comparison.layoutColumns')}
              onClick={() => setLayoutKind('columns')}
              icon={<Columns2 className="size-4" />}
            />
            <LayoutButton
              active={layoutKind === 'rows'}
              label={t('comparison.layoutRows')}
              onClick={() => setLayoutKind('rows')}
              icon={<Rows2 className="size-4" />}
            />
          </div>
        </div>
        <ResizablePanelGroup
          orientation={layoutKind === 'columns' ? 'horizontal' : 'vertical'}
          className="min-h-0 min-w-0 flex-1 overflow-hidden"
        >
          {target.panes.map((pane, index) => (
            <Fragment key={`${pane.projectId}:${pane.taskId}`}>
              {index > 0 && <ResizableHandle />}
              <ResizablePanel
                id={`cmp-${pane.taskId}`}
                minSize="15%"
                className="min-h-0 min-w-0 overflow-hidden"
              >
                <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
                  <ComparisonPaneHeader projectId={pane.projectId} taskId={pane.taskId} />
                  <div className="min-h-0 flex-1 overflow-hidden">
                    <ErrorBoundary variant="inline" componentName="ComparisonPane">
                      <SelfContainedTaskPane projectId={pane.projectId} taskId={pane.taskId} />
                    </ErrorBoundary>
                  </div>
                </div>
              </ResizablePanel>
            </Fragment>
          ))}
        </ResizablePanelGroup>
      </div>
      <ErrorBoundary variant="inline" componentName="ModalRenderer">
        <ModalRenderer />
      </ErrorBoundary>
      <Toaster />
    </>
  );
});

function LayoutButton({
  active,
  label,
  onClick,
  icon,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={cn(
        'flex size-7 items-center justify-center rounded-md transition-colors',
        active
          ? 'bg-background-2 text-foreground'
          : 'text-foreground-muted hover:bg-background-2 hover:text-foreground'
      )}
    >
      {icon}
    </button>
  );
}

const ComparisonPaneHeader = observer(function ComparisonPaneHeader({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const { t } = useTranslation();
  const name = getTaskStore(projectId, taskId)?.data.name ?? taskId.slice(0, 8);

  return (
    <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border bg-background-1/50 pl-2 pr-1">
      <span
        className="min-w-0 flex-1 truncate text-xs font-medium text-foreground-muted"
        title={name}
      >
        {name}
      </span>
      <button
        type="button"
        aria-label={t('comparison.openInMainWindow')}
        title={t('comparison.openInMainWindow')}
        onClick={() => void rpc.app.focusTaskInMainWindow({ projectId, taskId })}
        className="flex size-5 shrink-0 items-center justify-center rounded text-foreground-muted hover:bg-background-2 hover:text-foreground"
      >
        <PanelRightOpen className="size-3.5" />
      </button>
    </div>
  );
});
