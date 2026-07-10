import { Loader2, RotateCcw, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { TerminalPtyContent } from '@renderer/features/tasks/terminals/terminal-pty-content';
import { workspaceShellStore } from '@renderer/lib/stores/workspace-shell-store';
import { Button } from '@renderer/lib/ui/button';

export const WorkspaceShellPanel = observer(function WorkspaceShellPanel() {
  const { t } = useTranslation();
  const session = workspaceShellStore.session;
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {t('workspaceRuntime.cliTitle')} · {workspaceShellStore.title}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          title={t('workspaceRuntime.newShell')}
          onClick={() => {
            void workspaceShellStore.openShell().catch(() => {});
          }}
        >
          <RotateCcw className="size-3.5" />
        </Button>
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
