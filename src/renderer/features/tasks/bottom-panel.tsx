import { MessageSquareText, Terminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Activity } from 'react';
import { useTranslation } from 'react-i18next';
import { SessionHistoryPanel } from '@renderer/features/tasks/conversations/session-history-panel';
import type { BottomPanelTab } from '@renderer/features/tasks/stores/task-view';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { cn } from '@renderer/utils/utils';
import { TerminalsPanel } from './terminals/terminal-panel';

const TABS: { id: BottomPanelTab; icon: React.ReactNode; labelKey: string }[] = [
  {
    id: 'terminals',
    icon: <Terminal className="size-3" />,
    labelKey: 'tasks.bottomPanel.terminals',
  },
  {
    id: 'session',
    icon: <MessageSquareText className="size-3" />,
    labelKey: 'tasks.bottomPanel.session',
  },
];

/**
 * The abstracted bottom drawer: a slim tab strip switching between content
 * kinds (terminals, session history). Both stay mounted so PTY state survives
 * tab switches.
 */
export const BottomPanel = observer(function BottomPanel() {
  const { t } = useTranslation();
  const { taskView } = useProvisionedTask();
  const tab = taskView.bottomPanelTab;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border px-2">
        {TABS.map(({ id, icon, labelKey }) => (
          <button
            key={id}
            type="button"
            onClick={() => taskView.setBottomPanelTab(id)}
            className={cn(
              'flex h-5 items-center gap-1.5 rounded-sm px-2 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border',
              tab === id
                ? 'bg-background-2 text-foreground'
                : 'text-foreground-passive hover:text-foreground'
            )}
            aria-pressed={tab === id}
          >
            {icon}
            {t(labelKey)}
          </button>
        ))}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <Activity mode={tab === 'terminals' ? 'visible' : 'hidden'}>
          <TerminalsPanel />
        </Activity>
        <Activity mode={tab === 'session' ? 'visible' : 'hidden'}>
          <SessionHistoryPanel active={taskView.isTerminalDrawerOpen && tab === 'session'} />
        </Activity>
      </div>
    </div>
  );
});
