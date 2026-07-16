import { useEffect, type ReactNode } from 'react';
import { useDefaultLayout, usePanelRef } from 'react-resizable-panels';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@renderer/lib/ui/resizable';
import { cn } from '@renderer/utils/utils';

const LEFT_PANEL_DEFAULT_SIZE = '20%';
const LEFT_SIDEBAR_MIN_SIZE = '200px';
const LEFT_SIDEBAR_MAX_SIZE = '30%';
const MAIN_PANEL_MIN_SIZE = '30%';

interface WorkspaceLayoutProps {
  leftSidebar: ReactNode;
  mainContent: ReactNode;
  /**
   * Shell-level right side pane (cross-route pins). Pass null to collapse the
   * column entirely. Lives at the workspace level so main-area navigation
   * never unmounts it.
   */
  rightPane?: ReactNode;
}

export function WorkspaceLayout({ leftSidebar, mainContent, rightPane }: WorkspaceLayoutProps) {
  const { leftPanelRef, setIsLeftOpen, isLeftOpen } = useWorkspaceLayoutContext();
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'workspace-outer',
    storage: localStorage,
  });

  return (
    <ResizablePanelGroup
      id="workspace-outer"
      data-yoda-surface="workspace"
      orientation="horizontal"
      className="h-full w-full overflow-hidden"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      <ResizablePanel
        id="workspace-left"
        panelRef={leftPanelRef}
        defaultSize={LEFT_PANEL_DEFAULT_SIZE}
        minSize={LEFT_SIDEBAR_MIN_SIZE}
        maxSize={LEFT_SIDEBAR_MAX_SIZE}
        collapsedSize="0%"
        onResize={() => {
          const open = !leftPanelRef.current?.isCollapsed();
          if (open !== isLeftOpen) setIsLeftOpen(open);
        }}
        collapsible
      >
        <div data-yoda-surface="workspace-sidebar" className="h-full">
          {leftSidebar}
        </div>
      </ResizablePanel>
      <ResizableHandle
        className={cn(
          'items-center justify-center transition-colors hover:bg-border/80',
          isLeftOpen ? 'flex' : 'hidden'
        )}
      />
      <ResizablePanel
        id="workspace-main"
        data-yoda-surface="workspace-main"
        minSize={MAIN_PANEL_MIN_SIZE}
        className="relative bg-background text-foreground"
        data-modal-scope-root
      >
        {mainContent}
      </ResizablePanel>
      {rightPane ? (
        <>
          <ResizableHandle className="items-center justify-center transition-colors hover:bg-border/80" />
          <ResizablePanel
            id="workspace-right-pane"
            data-yoda-surface="workspace-right-pane"
            defaultSize="30%"
            minSize="280px"
            maxSize="50%"
            className="min-h-0 min-w-0 overflow-hidden border-l border-border bg-background text-foreground"
          >
            {rightPane}
          </ResizablePanel>
        </>
      ) : null}
    </ResizablePanelGroup>
  );
}

interface WorkspaceContentLayoutProps {
  titlebarSlot: ReactNode;
  mainPanel: ReactNode;
  bottomBar?: ReactNode;
  bottomPane?: ReactNode;
  isBottomPaneOpen?: boolean;
  onBottomPaneOpenChange?: (open: boolean) => void;
}

export function WorkspaceContentLayout({
  titlebarSlot,
  mainPanel,
  bottomBar,
  bottomPane,
  isBottomPaneOpen = false,
  onBottomPaneOpenChange,
}: WorkspaceContentLayoutProps) {
  const bottomPanelRef = usePanelRef();

  useEffect(() => {
    const panel = bottomPanelRef.current;
    if (!panel) return;
    if (isBottomPaneOpen && panel.isCollapsed()) panel.expand();
    if (!isBottomPaneOpen && !panel.isCollapsed()) panel.collapse();
  }, [bottomPanelRef, isBottomPaneOpen]);

  return (
    <div
      data-yoda-surface="workspace-content"
      className="flex h-full flex-col bg-background text-foreground"
    >
      <div className="select-none">{titlebarSlot}</div>
      <div className="min-h-0 flex-1 overflow-hidden bg-background text-foreground">
        <ResizablePanelGroup
          id="workspace-content-vertical"
          orientation="vertical"
          className="min-h-0"
        >
          <ResizablePanel
            id="workspace-content-main"
            minSize="30%"
            className="min-h-0 overflow-hidden"
          >
            <div
              data-yoda-surface="workspace-main-panel"
              className="flex h-full flex-col overflow-hidden bg-background text-foreground"
            >
              {mainPanel}
            </div>
          </ResizablePanel>
          <ResizableHandle className={isBottomPaneOpen ? 'flex' : 'hidden'} />
          <ResizablePanel
            id="workspace-content-bottom"
            panelRef={bottomPanelRef}
            defaultSize="32%"
            minSize="120px"
            collapsedSize="0%"
            collapsible
            className="min-h-0 overflow-hidden"
            onResize={() => {
              const open = !(bottomPanelRef.current?.isCollapsed() ?? true);
              if (open !== isBottomPaneOpen) onBottomPaneOpenChange?.(open);
            }}
          >
            {bottomPane}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      {bottomBar}
    </div>
  );
}
