import { Loader2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { getRuntime } from '@shared/runtime-registry';
import { TerminalPtyContent } from '@renderer/features/tasks/terminals/terminal-pty-content';
import { workspaceShellStore } from '@renderer/lib/stores/workspace-shell-store';
import { Button } from '@renderer/lib/ui/button';

export const WorkspaceShellPanel = observer(function WorkspaceShellPanel() {
  const { t } = useTranslation();
  const session = workspaceShellStore.session;
  const runtimeName = workspaceShellStore.runtimeId
    ? (getRuntime(workspaceShellStore.runtimeId)?.name ?? workspaceShellStore.runtimeId)
    : null;
  const title =
    workspaceShellStore.mode === 'runtime-action' &&
    workspaceShellStore.runtimeAction &&
    runtimeName
      ? t(`workspaceRuntime.actions.${workspaceShellStore.runtimeAction}`, { name: runtimeName })
      : t('workspaceRuntime.terminal');
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-background-secondary px-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{title}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          title={t('common.close')}
          onClick={() => workspaceShellStore.close()}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      {workspaceShellStore.error ? (
        <p className="shrink-0 border-b border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
          {workspaceShellStore.error}
        </p>
      ) : null}
      <TerminalPtyContent
        className="min-h-0 flex-1"
        activeSession={session}
        allSessionIds={session ? [session.sessionId] : []}
        paneId="workspace-shell"
        active={workspaceShellStore.isOpen}
        autoFocus={workspaceShellStore.isOpen}
        emptyState={
          <div className="flex h-full items-center justify-center text-foreground-muted">
            <Loader2 className="size-4 animate-spin" />
          </div>
        }
      />
    </div>
  );
});
