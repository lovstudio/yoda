import { Check, ChevronsUpDown, MessageSquareText, Terminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Activity } from 'react';
import { useTranslation } from 'react-i18next';
import { SessionHistoryPanel } from '@renderer/features/tasks/conversations/session-history-panel';
import type { BottomPanelTab } from '@renderer/features/tasks/stores/task-view';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { TerminalsPanel } from './terminals/terminal-panel';

const MODES: { id: BottomPanelTab; icon: React.ReactNode; labelKey: string }[] = [
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
 * The abstracted bottom drawer: the strip shows only the CURRENT mode; a
 * dropdown at the right end switches between content kinds (terminals,
 * session history, …). Both panels stay mounted so PTY state survives
 * mode switches.
 */
export const BottomPanel = observer(function BottomPanel() {
  const { t } = useTranslation();
  const { taskView } = useProvisionedTask();
  const tab = taskView.bottomPanelTab;
  const current = MODES.find((m) => m.id === tab) ?? MODES[0];

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex h-7 shrink-0 items-center border-b border-border px-3">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-foreground-muted">
          <span className="shrink-0 text-foreground-passive">{current.icon}</span>
          <span className="truncate">{t(current.labelKey)}</span>
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="ml-auto flex size-5 items-center justify-center rounded-sm text-foreground-passive transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
                aria-label={t('tasks.bottomPanel.switchMode')}
                title={t('tasks.bottomPanel.switchMode')}
              >
                <ChevronsUpDown className="size-3" />
              </button>
            }
          />
          <DropdownMenuContent align="end" className="w-44">
            {MODES.map(({ id, icon, labelKey }) => (
              <DropdownMenuItem key={id} onClick={() => taskView.setBottomPanelTab(id)}>
                <span className="flex size-3.5 shrink-0 items-center justify-center text-foreground-passive">
                  {icon}
                </span>
                <span className="min-w-0 flex-1 truncate">{t(labelKey)}</span>
                {tab === id ? <Check className="size-3 shrink-0" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
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
