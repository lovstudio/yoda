import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { buildFilePathDefaultOpenRequest } from '@renderer/lib/components/file-path-open';
import { rpc } from '@renderer/lib/ipc';
import type { TerminalFileLinkOptions } from '@renderer/lib/pty/terminal-file-links';

/**
 * File-link options for workspace-bound PTY panes (drawer terminals/scripts):
 * clicking a path opens it in the task sidebar so the pane stays visible.
 */
export function useWorkspaceFileLinks(
  remoteConnectionId: string | undefined
): TerminalFileLinkOptions {
  const provisionedTask = useProvisionedTask();
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
      onOpen: ({ filePath, absolutePath, line, column, isDirectory }) => {
        if (filePath) {
          // Open into the sidebar so the pane stays visible.
          provisionedTask.taskView.tabManager.openFileInSidebar(filePath, { line, column });
          provisionedTask.taskView.setSidebarCollapsed(false);
          return;
        }
        if (absolutePath) {
          void rpc.app.openIn(
            buildFilePathDefaultOpenRequest({
              absolutePath,
              kind: isDirectory ? 'directory' : 'file',
              sshConnectionId: remoteConnectionId,
              line,
              column,
            })
          );
        }
      },
    }),
    [provisionedTask.path, provisionedTask.taskView, projectRoot, remoteConnectionId, homeDir]
  );
}
