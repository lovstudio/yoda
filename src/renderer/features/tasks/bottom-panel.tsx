import {
  Check,
  ChevronsUpDown,
  MessageSquareText,
  Pause,
  Play,
  Plus,
  ScrollText,
  Settings,
  Terminal,
  X,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Activity, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { BottomPanelTab } from '@shared/view-state';
import { SessionHistoryPanel } from '@renderer/features/tasks/conversations/session-history-panel';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { isImeComposing } from '@renderer/utils/ime';
import { cn } from '@renderer/utils/utils';
import { ScriptsPanel } from './terminals/scripts-panel';
import { TerminalsPanel } from './terminals/terminal-panel';
import { scriptIcon } from './terminals/terminal-tabs';
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
  'flex size-5 shrink-0 items-center justify-center rounded-sm text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border';

/**
 * The abstracted bottom drawer, laid out as a tab bar: the mode label sits at
 * the left, the mode's items (terminals / scripts) render as tabs next to it
 * with their "new" action glued after; config-type actions sit at the tail
 * and close is last. All panels stay mounted so PTY state survives switches.
 */
export const BottomPanel = observer(function BottomPanel() {
  const { t } = useTranslation();
  const { projectId } = useTaskViewContext();
  const provisionedTask = useProvisionedTask();
  const { taskView } = provisionedTask;
  const { navigate } = useNavigate();
  const createTerminal = useCreateTerminal();
  const tab = taskView.bottomPanelTab;
  const current = MODES.find((m) => m.id === tab) ?? MODES[0];

  const terminalMgr = provisionedTask.terminals;
  const terminalTabView = taskView.terminalTabs;
  const lifecycleScriptsMgr = provisionedTask.workspace.lifecycleScripts ?? null;
  const scripts = lifecycleScriptsMgr?.tabs ?? [];
  const activeScript = lifecycleScriptsMgr?.activeTab ?? scripts[0];

  const runActiveScript = () => {
    if (!activeScript) return;
    activeScript.markRunning();
    void rpc.terminals
      .runLifecycleScript({
        projectId,
        workspaceId: provisionedTask.workspaceId,
        type: activeScript.data.type,
      })
      .catch(() => {
        activeScript.markExited();
      });
  };

  const stopActiveScript = () => {
    if (!activeScript) return;
    void rpc.pty.sendInput(activeScript.session.sessionId, '\x03');
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border px-2">
        {/* Mode switcher: current mode's icon + chevron, leftmost. */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="flex h-5 shrink-0 items-center gap-1 rounded-sm px-1.5 text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
                aria-label={t('tasks.bottomPanel.switchMode')}
                title={`${t(current.labelKey)} — ${t('tasks.bottomPanel.switchMode')}`}
              >
                {current.icon}
                <ChevronsUpDown className="size-2.5" />
              </button>
            }
          />
          <DropdownMenuContent align="start" className="w-44">
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
        <div aria-hidden className="mx-0.5 h-3.5 w-px shrink-0 bg-border" />
        {/* Mode items as tabs + contextual "new" action glued after. */}
        <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
          {tab === 'terminals'
            ? terminalTabView.tabs.map((terminal) => (
                <ItemTab
                  key={terminal.data.id}
                  icon={<Terminal className="size-3" />}
                  label={terminal.data.name}
                  isActive={terminalTabView.activeTabId === terminal.data.id}
                  onSelect={() => terminalTabView.setActiveTab(terminal.data.id)}
                  onRename={(name) => void terminalMgr?.renameTerminal(terminal.data.id, name)}
                  action={
                    <button
                      type="button"
                      className="flex size-3.5 items-center justify-center rounded-sm text-foreground-passive opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover/tab:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        terminalTabView.removeTab(terminal.data.id);
                      }}
                      aria-label={t('tasks.terminals.closeTerminal')}
                      title={t('tasks.terminals.closeTerminal')}
                    >
                      <X className="size-2.5" />
                    </button>
                  }
                />
              ))
            : null}
          {tab === 'scripts'
            ? scripts.map((script) => {
                const isActive = activeScript?.data.id === script.data.id;
                return (
                  <ItemTab
                    key={script.data.id}
                    icon={scriptIcon(script.data.type)}
                    label={script.data.label}
                    isActive={isActive}
                    onSelect={() => lifecycleScriptsMgr?.setActiveTab(script.data.id)}
                    action={
                      isActive ? (
                        <button
                          type="button"
                          className="flex size-3.5 items-center justify-center rounded-sm text-foreground-passive hover:bg-background hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (script.isRunning) {
                              stopActiveScript();
                            } else {
                              runActiveScript();
                            }
                          }}
                          aria-label={script.isRunning ? t('common.stop') : t('common.run')}
                          title={script.isRunning ? t('common.stop') : t('common.run')}
                        >
                          {script.isRunning ? (
                            <Pause className="size-2.5" />
                          ) : (
                            <Play className="size-2.5" />
                          )}
                        </button>
                      ) : null
                    }
                  />
                );
              })
            : null}
        </div>
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
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
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

/**
 * One mode item (terminal / script) as a strip tab: click selects,
 * double-click renames (when supported), trailing action slot for
 * close / run / stop.
 */
function ItemTab({
  icon,
  label,
  isActive,
  onSelect,
  onRename,
  action,
}: {
  icon?: ReactNode;
  label: string;
  isActive: boolean;
  onSelect: () => void;
  onRename?: (name: string) => void;
  action?: ReactNode;
}) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div
      className={cn(
        'group/tab flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded-sm px-1.5 text-[11px] transition-colors',
        isActive
          ? 'bg-background-2 text-foreground'
          : 'text-foreground-passive hover:text-foreground'
      )}
      onClick={onSelect}
      onDoubleClick={(e) => {
        if (!onRename) return;
        e.stopPropagation();
        setIsEditing(true);
      }}
    >
      {icon ? <span className="shrink-0">{icon}</span> : null}
      {isEditing && onRename ? (
        <InlineRenameInput
          initialValue={label}
          onConfirm={(name) => {
            setIsEditing(false);
            if (name && name !== label) onRename(name);
          }}
          onCancel={() => setIsEditing(false)}
        />
      ) : (
        <span className="max-w-32 truncate">{label}</span>
      )}
      {action}
    </div>
  );
}

function InlineRenameInput({
  initialValue,
  onConfirm,
  onCancel,
}: {
  initialValue: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      className="w-24 bg-transparent text-[11px] text-foreground outline-none"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onConfirm(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !isImeComposing(e)) onConfirm(value);
        if (e.key === 'Escape') onCancel();
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
