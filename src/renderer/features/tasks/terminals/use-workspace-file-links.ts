import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { openProjectFileTab } from '@renderer/features/project-file/project-file-session';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import type { TaskViewStore } from '@renderer/features/tasks/stores/task-view';
import { useRequireProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import {
  openTerminalFileLinkExternally,
  reportTerminalFileLinkFailure,
} from '@renderer/lib/pty/terminal-file-link-actions';
import {
  getTerminalFileLinkInternalDestination,
  type TerminalFileLinkInternalDestination,
} from '@renderer/lib/pty/terminal-file-link-open';
import type { TerminalFileLinkOptions } from '@renderer/lib/pty/terminal-file-links';

/**
 * File-link options for task-scoped PTY panes (drawer terminals/scripts, agent
 * conversations): clicking a path opens it in the task sidebar so the pane that
 * printed the link stays visible.
 */
export function useWorkspaceFileLinks(
  remoteConnectionId: string | undefined
): TerminalFileLinkOptions {
  const provisionedTask = useRequireProvisionedTask();
  const projectRoot = asMounted(getProjectStore(provisionedTask.projectId))?.data.path;
  const { data: homeDir } = useQuery({
    queryKey: ['homeDir'],
    queryFn: () => rpc.app.getHomeDir(),
    staleTime: Infinity,
    enabled: !remoteConnectionId,
  });

  return useMemo<TerminalFileLinkOptions>(
    () => ({
      workspaceRoot: provisionedTask.path,
      workspaceRootAliases: projectRoot ? [projectRoot] : undefined,
      homeDir: typeof homeDir === 'string' ? homeDir : undefined,
      sshConnectionId: remoteConnectionId,
      onOpen: (target) => {
        const { line, column } = target;
        const destination = getTerminalFileLinkInternalDestination(target, {
          sshConnectionId: remoteConnectionId,
        });
        if (destination) {
          void openFileInTaskSidebar(destination, provisionedTask.taskView, { line, column });
          return;
        }
        void openTerminalFileLinkExternally(target, { sshConnectionId: remoteConnectionId });
      },
    }),
    [provisionedTask.path, provisionedTask.taskView, projectRoot, remoteConnectionId, homeDir]
  );
}

/**
 * Land a terminal file link in the task sidebar. Paths outside the workspace sit
 * beyond its FS jail, so grant access before the editor reads them — otherwise
 * the tab opens onto a read error.
 */
async function openFileInTaskSidebar(
  destination: TerminalFileLinkInternalDestination,
  taskView: TaskViewStore,
  location: { line?: number; column?: number }
): Promise<void> {
  if (destination.placement === 'global') {
    const result = await rpc.app.authorizeExternalFile(destination.path);
    if (!result.success) {
      reportTerminalFileLinkFailure(result.error, {
        path: destination.path,
        stage: 'authorize',
      });
      return;
    }
  }
  taskView.tabManager.openFileInSidebar(destination.path, location);
  // Pinning while the sidebar is hidden would silently swallow the tab.
  taskView.setSidebarCollapsed(false);
}

/**
 * Links for the shell-level project/global Terminal. This surface outlives task
 * routes, so files open in a project/global app tab instead of a task sidebar.
 */
export function useDefaultWorkspaceFileLinks(
  projectId: string | null,
  workspaceRoot: string | undefined,
  remoteConnectionId: string | undefined
): TerminalFileLinkOptions | null {
  const { data: homeDir } = useQuery({
    queryKey: ['homeDir'],
    queryFn: () => rpc.app.getHomeDir(),
    staleTime: Infinity,
    enabled: !remoteConnectionId,
  });
  const resolvedHomeDir = typeof homeDir === 'string' ? homeDir : undefined;
  const resolvedWorkspaceRoot = workspaceRoot ?? resolvedHomeDir;

  return useMemo<TerminalFileLinkOptions | null>(() => {
    if (!resolvedWorkspaceRoot) return null;
    return {
      workspaceRoot: resolvedWorkspaceRoot,
      homeDir: resolvedHomeDir,
      sshConnectionId: remoteConnectionId,
      onOpen: (target) => {
        const { filePath, absolutePath, isDirectory } = target;
        if (!isDirectory && projectId && filePath) {
          openProjectFileTab(projectId, filePath);
          return;
        }
        if (!isDirectory && !remoteConnectionId && absolutePath) {
          openProjectFileTab(null, absolutePath);
          return;
        }
        void openTerminalFileLinkExternally(target, { sshConnectionId: remoteConnectionId });
      },
    };
  }, [projectId, remoteConnectionId, resolvedHomeDir, resolvedWorkspaceRoot]);
}
