import { type ReactNode } from 'react';
import { useDefaultLayout } from 'react-resizable-panels';
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
        {leftSidebar}
      </ResizablePanel>
      <ResizableHandle
        className={cn(
          'items-center justify-center transition-colors hover:bg-border/80',
          isLeftOpen ? 'flex' : 'hidden'
        )}
      />
      <ResizablePanel
        id="workspace-main"
        minSize={MAIN_PANEL_MIN_SIZE}
        className="bg-background text-foreground"
      >
        {mainContent}
      </ResizablePanel>
      {rightPane ? (
        <>
          <ResizableHandle className="items-center justify-center transition-colors hover:bg-border/80" />
          <ResizablePanel
            id="workspace-right-pane"
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
}

export function WorkspaceContentLayout({ titlebarSlot, mainPanel }: WorkspaceContentLayoutProps) {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {titlebarSlot}
      <div className="flex-1 overflow-hidden bg-background text-foreground">
        <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
          {mainPanel}
        </div>
      </div>
    </div>
  );
}
