import { useMemo } from 'react';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import type { TerminalWebLinkOptions } from '@renderer/lib/pty/terminal-web-links';

/**
 * Web-link options for workspace-bound PTY panes: clicking a smart URL link
 * navigates the task sidebar's resident browser card so the pane stays
 * visible. The right-click link menu keeps the system-browser escape hatch.
 */
export function useWorkspaceWebLinks(): TerminalWebLinkOptions {
  const provisionedTask = useProvisionedTask();

  return useMemo<TerminalWebLinkOptions>(
    () => ({
      onOpen: (url) => {
        provisionedTask.taskView.openBrowser(url);
      },
    }),
    [provisionedTask.taskView]
  );
}
