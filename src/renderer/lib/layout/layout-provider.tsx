import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { usePanelRef, type PanelImperativeHandle } from 'react-resizable-panels';
import { rpc } from '@renderer/lib/ipc';

export interface WorkspaceLayoutContextValue {
  isLeftOpen: boolean;
  leftPanelRef: RefObject<PanelImperativeHandle | null>;
  setIsLeftOpen: (open: boolean) => void;
  setCollapsed: (side: 'left', collapsed: boolean) => void;
  toggleLeft: () => void;
}

const WorkspaceLayoutContext = createContext<WorkspaceLayoutContextValue | undefined>(undefined);

export function useWorkspaceLayoutService() {
  const leftPanelRef = usePanelRef();

  const [isLeftOpen, setIsLeftOpen] = useState(true);

  const setCollapsed = useCallback(
    (side: 'left', collapsed: boolean) => {
      const panel = leftPanelRef.current;
      if (!panel) return;
      if (collapsed) {
        panel.collapse();
      } else {
        panel.expand();
      }
      setIsLeftOpen(!collapsed);
    },
    [leftPanelRef]
  );

  const toggleLeft = useCallback(() => {
    setCollapsed('left', isLeftOpen);
  }, [setCollapsed, isLeftOpen]);

  useEffect(() => {
    void rpc.app.setLeftSidebarMenuChecked(isLeftOpen);
  }, [isLeftOpen]);

  return {
    leftPanelRef,
    setIsLeftOpen,
    isLeftOpen,
    setCollapsed,
    toggleLeft,
  };
}

export function WorkspaceLayoutContextProvider({ children }: { children: ReactNode }) {
  const value = useWorkspaceLayoutService();
  return (
    <WorkspaceLayoutContext.Provider value={value}>{children}</WorkspaceLayoutContext.Provider>
  );
}

export function useWorkspaceLayoutContext() {
  const context = useContext(WorkspaceLayoutContext);
  if (!context) {
    throw new Error(
      'useWorkspaceLayoutContext must be used within a WorkspaceLayoutContextProvider'
    );
  }
  return context;
}
