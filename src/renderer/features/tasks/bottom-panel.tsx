import {
  Check,
  ChevronsUpDown,
  MessageSquareText,
  Plus,
  ScrollText,
  Settings,
  Terminal,
  X,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Activity } from 'react';
import { useTranslation } from 'react-i18next';
import { SessionHistoryPanel } from '@renderer/features/tasks/conversations/session-history-panel';
import type { BottomPanelTab } from '@renderer/features/tasks/stores/task-view';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { ScriptsPanel } from './terminals/scripts-panel';
import { TerminalsPanel } from './terminals/terminal-panel';
import { useCreateTerminal } from './terminals/use-create-terminal';

const MODES: { id: BottomPanelTab; icon: React.ReactNode; labelKey: string }[] = [
  {
    id: 'terminals',
    icon: <Terminal className="size-3" />,
    labelKey: 'tasks.bottomPanel.terminals',
  },
  {
    id: 'scripts',
    icon: <ScrollText className="size-3" />,
    labelKey: 'tasks.terminals.scripts',
  },
  {
    id: 'session',
    icon: <MessageSquareText className="size-3" />,
    labelKey: 'tasks.bottomPanel.session',
  },
];

const ICON_BUTTON_CLASS =
  'flex size-5 items-center justify-center rounded-sm text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border';

/**
 * The abstracted bottom drawer, laid out like a tab bar: the current mode
 * renders as the active tab on the left with its contextual "new" action
 * right next to it; config-type actions sit at the tail and close is last.
 * All panels stay mounted so PTY state survives mode switches.
 */
export const BottomPanel = observer(function BottomPanel() {
  const { t } = useTranslation();
  const { projectId } = useTaskViewContext();
  const { taskView } = useProvisionedTask();
  const { navigate } = useNavigate();
  const createTerminal = useCreateTerminal();
  const tab = taskView.bottomPanelTab;
  const current = MODES.find((m) => m.id === tab) ?? MODES[0];

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border px-2">
        {/* Active tab. */}
        <span className="flex h-5 min-w-0 items-center gap-1.5 rounded-sm bg-background-2 px-2 text-[11px] text-foreground">
          <span className="shrink-0 text-foreground-passive">{current.icon}</span>
          <span className="truncate">{t(current.labelKey)}</span>
        </span>
        {/* Contextual "new" action, glued to the active tab. */}
        {tab === 'terminals' ? (
          <button
            type="button"
            className={ICON_BUTTON_CLASS}
            onClick={() => void createTerminal()}
            aria-label={t('tasks.terminals.newTerminal')}
            title={t('tasks.terminals.newTerminal')}
          >
            <Plus className="size-3" />
          </button>
        ) : null}
        {/* Tail: config-type actions, then the mode switcher, close last. */}
        <div className="ml-auto flex items-center gap-0.5">
          {tab === 'scripts' ? (
            <button
              type="button"
              className={ICON_BUTTON_CLASS}
              onClick={() => navigate('project', { projectId, view: 'settings' })}
              aria-label={t('tasks.terminals.configureInProjectSettings')}
              title={t('tasks.terminals.configureInProjectSettings')}
            >
              <Settings className="size-3" />
            </button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className={ICON_BUTTON_CLASS}
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
          <button
            type="button"
            className={ICON_BUTTON_CLASS}
            onClick={() => taskView.setTerminalDrawerOpen(false)}
            aria-label={t('common.close')}
            title={t('common.close')}
          >
            <X className="size-3" />
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <Activity mode={tab === 'terminals' ? 'visible' : 'hidden'}>
          <TerminalsPanel />
        </Activity>
        <Activity mode={tab === 'scripts' ? 'visible' : 'hidden'}>
          <ScriptsPanel />
        </Activity>
        <Activity mode={tab === 'session' ? 'visible' : 'hidden'}>
          <SessionHistoryPanel active={taskView.isTerminalDrawerOpen && tab === 'session'} />
        </Activity>
      </div>
    </div>
  );
});
