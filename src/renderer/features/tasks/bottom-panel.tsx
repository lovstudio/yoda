import {
  FoldHorizontal,
  MessageSquareText,
  Plus,
  ScrollText,
  Settings,
  Terminal,
  UnfoldHorizontal,
  X,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Activity, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { BottomPanelTab } from '@shared/view-state';
import { SessionHistoryPanel } from '@renderer/features/tasks/conversations/session-history-panel';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { FeatureCard } from '@renderer/lib/components/feature-card';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { cn } from '@renderer/utils/utils';
import { ScriptsPanel } from './terminals/scripts-panel';
import { TerminalsPanel } from './terminals/terminal-panel';

const MODES: {
  id: BottomPanelTab;
  icon: React.ReactNode;
  labelKey: string;
  descKey: string;
}[] = [
  {
    id: 'terminals',
    icon: <Terminal className="size-3" />,
    labelKey: 'tasks.bottomPanel.terminals',
    descKey: 'tasks.bottomPanel.cardDescTerminals',
  },
  {
    id: 'scripts',
    icon: <ScrollText className="size-3" />,
    labelKey: 'tasks.terminals.scripts',
    descKey: 'tasks.bottomPanel.cardDescScripts',
  },
  {
    id: 'session',
    icon: <MessageSquareText className="size-3" />,
    labelKey: 'tasks.bottomPanel.session',
    descKey: 'tasks.bottomPanel.cardDescSession',
  },
];

const ICON_BUTTON_CLASS =
  'flex size-5 shrink-0 items-center justify-center rounded-sm text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border';

/**
 * The abstracted bottom drawer, mirroring the task sidebar's strip: mode tabs
 * are individually closable, a "+" picker adds the remaining ones, and an
 * empty strip shows feature cards. Each mode's items (terminal list, script
 * run/stop) live inside its panel as a resizable side column; config-type
 * actions sit at the strip's tail and close is last. All panels stay mounted
 * so PTY state survives switches.
 */
export const BottomPanel = observer(function BottomPanel() {
  const { t } = useTranslation();
  const { projectId } = useTaskViewContext();
  const provisionedTask = useProvisionedTask();
  const { taskView } = provisionedTask;
  const { navigate } = useNavigate();
  const openTabs = taskView.openBottomPanelTabs;
  const tab = taskView.activeBottomPanelTab;
  const openModes = openTabs.flatMap((id) => MODES.filter((m) => m.id === id));
  const availableModes = MODES.filter((m) => !openTabs.includes(m.id));

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border px-2">
        {/* Mode tabs side by side (same interaction as the sidebar chip
            strip): each closable, "+" adds the remaining ones. */}
        <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
          {openModes.map(({ id, icon, labelKey }) => (
            <ModeTab
              key={id}
              icon={icon}
              label={t(labelKey)}
              isActive={tab === id}
              onSelect={() => taskView.setBottomPanelTab(id)}
              onClose={() => taskView.closeBottomPanelTab(id)}
              closeLabel={t('tasks.sidePane.removeCard')}
            />
          ))}
          {availableModes.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={ICON_BUTTON_CLASS}
                aria-label={t('tasks.sidePane.addCard')}
                title={t('tasks.sidePane.addCard')}
              >
                <Plus className="size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-auto">
                {availableModes.map(({ id, icon, labelKey }) => (
                  <DropdownMenuItem key={id} onClick={() => taskView.setBottomPanelTab(id)}>
                    {icon}
                    {t(labelKey)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        {/* Tail: config-type actions, close last. */}
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
          <BottomPanelWidthToggle />
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
        {/* Empty state: feature cards for every available mode, like the sidebar. */}
        {!tab ? (
          <div className="flex h-full items-center justify-center overflow-y-auto p-4">
            <div className="flex w-full max-w-3xl flex-wrap items-stretch justify-center gap-2">
              {availableModes.map(({ id, icon, labelKey, descKey }, index) => (
                <FeatureCard
                  key={id}
                  className="w-60"
                  icon={icon}
                  label={t(labelKey)}
                  description={t(descKey)}
                  index={index}
                  onSelect={() => taskView.setBottomPanelTab(id)}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
});

/**
 * Toggles whether the drawer spans the full window width (under the sidebar)
 * or yields to a full-height sidebar. Disabled while the sidebar is collapsed
 * — without a sidebar both layouts are identical.
 */
const BottomPanelWidthToggle = observer(function BottomPanelWidthToggle() {
  const { t } = useTranslation();
  const { taskView } = useProvisionedTask();
  const fullWidth = taskView.isBottomPanelFullWidth;
  const disabled = taskView.isSidebarCollapsed;
  const label = fullWidth
    ? t('tasks.bottomPanel.layoutBesideSidebar')
    : t('tasks.bottomPanel.layoutFullWidth');
  return (
    <button
      type="button"
      className={cn(ICON_BUTTON_CLASS, disabled && 'pointer-events-none opacity-40')}
      disabled={disabled}
      onClick={() => taskView.setBottomPanelFullWidth(!fullWidth)}
      aria-label={label}
      title={label}
    >
      {fullWidth ? <FoldHorizontal className="size-3" /> : <UnfoldHorizontal className="size-3" />}
    </button>
  );
});

/** One mode tab in the strip: click selects, hover reveals its close action. */
function ModeTab({
  icon,
  label,
  isActive,
  onSelect,
  onClose,
  closeLabel,
}: {
  icon?: ReactNode;
  label: string;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
  closeLabel: string;
}) {
  return (
    <div
      className={cn(
        'group/tab flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded-sm px-1.5 text-[11px] transition-colors',
        isActive
          ? 'bg-background-2 text-foreground'
          : 'text-foreground-passive hover:text-foreground'
      )}
      onClick={onSelect}
      onAuxClick={(event) => {
        if (event.button === 1) onClose();
      }}
    >
      {icon ? <span className="shrink-0">{icon}</span> : null}
      <span className="max-w-32 truncate">{label}</span>
      <button
        type="button"
        className="flex size-3.5 items-center justify-center rounded-sm text-foreground-passive opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover/tab:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label={closeLabel}
        title={closeLabel}
      >
        <X className="size-2.5" />
      </button>
    </div>
  );
}
