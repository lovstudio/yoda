import { Terminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { projectlessSessionStore } from '@renderer/features/projectless/projectless-session-store';
import { AgentStatusIndicator } from '@renderer/features/tasks/components/agent-status-indicator';
import AgentLogo from '@renderer/lib/components/agent-logo';
import {
  useNavigate,
  useParams,
  useWorkspaceSlots,
} from '@renderer/lib/layout/navigation-provider';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import { SidebarMenuRow } from './sidebar-primitives';

export const SidebarProjectlessSessionItem = observer(function SidebarProjectlessSessionItem({
  sessionId,
}: {
  sessionId: string;
}) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();
  const { params } = useParams('projectless');
  const session = projectlessSessionStore.sessions.get(sessionId);

  const handleOpen = useCallback(() => {
    if (!session) return;
    navigate('projectless', {
      sessionId: session.sessionId,
      title: session.title,
      cwd: session.cwd,
      providerId: session.providerId,
    });
  }, [navigate, session]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      handleOpen();
    },
    [handleOpen]
  );

  if (!session) return null;

  const isActive = currentView === 'projectless' && params.sessionId === sessionId;
  const agent = session.providerId ? agentConfig[session.providerId] : null;

  return (
    <SidebarMenuRow
      className="group/row flex h-8 items-center justify-between gap-1 px-1 pl-2"
      isActive={isActive}
      role="button"
      tabIndex={0}
      title={session.cwd}
      aria-label={t('sidebar.openSessionDetails')}
      onMouseDown={(event) => event.preventDefault()}
      onClick={handleOpen}
      onKeyDown={handleKeyDown}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch overflow-hidden">
        {agent ? (
          <span
            className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-background-2"
            title={agent.name}
          >
            <AgentLogo
              logo={agent.logo}
              alt={agent.alt}
              isSvg={agent.isSvg}
              invertInDark={agent.invertInDark}
              className="size-3"
            />
          </span>
        ) : (
          <Terminal className="size-4 shrink-0 text-foreground-tertiary-muted" />
        )}
        <span
          className={cn(
            'min-w-0 truncate text-left transition-colors',
            session.status === 'idle' && 'text-foreground/60'
          )}
        >
          {session.title}
        </span>
      </div>
      <AgentStatusIndicator status={session.status} />
    </SidebarMenuRow>
  );
});
