import { Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { TerminalPtyContent } from '@renderer/features/tasks/terminals/terminal-pty-content';
import { workspaceShellStore } from '@renderer/lib/stores/workspace-shell-store';

/**
 * Shared chrome-free workspace-shell terminal body.
 *
 * Quick Actions keep their project-root execution contract while the same PTY
 * moves between the workspace drawer and a task's terminal panel.
 */
export const WorkspaceShellTerminal = observer(function WorkspaceShellTerminal({
  active,
  paneId,
}: {
  active: boolean;
  paneId: string;
}) {
  const session = workspaceShellStore.session;
  const activeSession = active ? session : null;

  return (
    <>
      {active && workspaceShellStore.error ? (
        <p className="shrink-0 border-b border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
          {workspaceShellStore.error}
        </p>
      ) : null}
      <TerminalPtyContent
        className="min-h-0 flex-1"
        activeSession={activeSession}
        allSessionIds={activeSession ? [activeSession.sessionId] : []}
        paneId={paneId}
        active={active}
        autoFocus={active}
        emptyState={
          <div className="flex h-full items-center justify-center text-foreground-muted">
            <Loader2 className="size-4 animate-spin" />
          </div>
        }
      />
    </>
  );
});
