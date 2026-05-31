import { Terminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { projectlessSessionStore } from '@renderer/features/projectless/projectless-session-store';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { PaneSizingProvider } from '@renderer/lib/pty/pane-sizing-context';
import { PtyPane } from '@renderer/lib/pty/pty-pane';
import { TerminalSearchOverlay } from '@renderer/lib/pty/terminal-search-overlay';
import { useTerminalSearch } from '@renderer/lib/pty/use-terminal-search';

export function ProjectlessTitlebar() {
  return <Titlebar />;
}

export function ProjectlessViewWrapper({
  children,
}: {
  children: ReactNode;
  sessionId: string;
  title: string;
  cwd: string;
  providerId?: AgentProviderId;
}) {
  return <>{children}</>;
}

export const ProjectlessMainPanel = observer(function ProjectlessMainPanel() {
  const { t } = useTranslation();
  const { params } = useParams('projectless');
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<{ focus: () => void }>(null);
  const session = useMemo(
    () => projectlessSessionStore.ensurePtySession(params.sessionId),
    [params.sessionId]
  );
  const sessionIds = useMemo(() => [params.sessionId], [params.sessionId]);

  useEffect(() => {
    projectlessSessionStore.registerNavigatedSession({
      sessionId: params.sessionId,
      title: params.title || t('projects.noProject'),
      cwd: params.cwd,
      providerId: params.providerId,
    });
  }, [params.cwd, params.providerId, params.sessionId, params.title, t]);

  useEffect(() => {
    void session.connect();
  }, [session]);

  useEffect(() => {
    if (session.status !== 'ready') return;
    terminalRef.current?.focus();
  }, [session.status]);

  const {
    isSearchOpen,
    searchQuery,
    searchStatus,
    searchInputRef,
    closeSearch,
    handleSearchQueryChange,
    stepSearch,
  } = useTerminalSearch({
    terminal: session.pty?.terminal,
    containerRef: terminalContainerRef,
    enabled: Boolean(session.pty),
    onCloseFocus: () => terminalRef.current?.focus(),
  });

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
        <Terminal className="size-4 text-foreground-muted" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {params.title || t('projects.noProject')}
          </div>
          <div className="truncate text-xs text-foreground-muted">cwd: {params.cwd}</div>
        </div>
      </div>
      <PaneSizingProvider paneId="projectless-session" sessionIds={sessionIds}>
        <div ref={terminalContainerRef} className="relative min-h-0 flex-1">
          <TerminalSearchOverlay
            isOpen={isSearchOpen}
            fullWidth
            searchQuery={searchQuery}
            searchStatus={searchStatus}
            searchInputRef={searchInputRef}
            onQueryChange={handleSearchQueryChange}
            onStep={stepSearch}
            onClose={closeSearch}
          />
          {session.status === 'ready' && session.pty ? (
            <PtyPane
              ref={terminalRef}
              sessionId={params.sessionId}
              pty={session.pty}
              className="h-full w-full"
              mapShiftEnterToCtrlJ
            />
          ) : null}
        </div>
      </PaneSizingProvider>
    </div>
  );
});

export const projectlessView = {
  WrapView: ProjectlessViewWrapper,
  TitlebarSlot: ProjectlessTitlebar,
  MainPanel: ProjectlessMainPanel,
};
