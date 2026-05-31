import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { projectlessSessionStore } from '@renderer/features/projectless/projectless-session-store';
import { SidebarProjectlessSessionItem } from './projectless-session-item';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarSectionHeader,
} from './sidebar-primitives';

export const SidebarProjectlessSessionList = observer(function SidebarProjectlessSessionList() {
  const { t } = useTranslation();
  const sessions = projectlessSessionStore.sortedSessions;
  const showList = !projectlessSessionStore.collapsed && sessions.length > 0;

  return (
    <SidebarGroup className="mb-0 shrink-0 flex flex-col">
      <SidebarSectionHeader
        label={t('sidebar.conversations')}
        collapsed={projectlessSessionStore.collapsed}
        onToggle={() => projectlessSessionStore.toggleCollapsed()}
      />
      {showList && (
        <SidebarGroupContent className="min-h-0">
          <SidebarMenu className="max-h-48 overflow-y-auto px-3 pb-3">
            {sessions.map((session) => (
              <SidebarProjectlessSessionItem
                key={session.sessionId}
                sessionId={session.sessionId}
              />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      )}
    </SidebarGroup>
  );
});
