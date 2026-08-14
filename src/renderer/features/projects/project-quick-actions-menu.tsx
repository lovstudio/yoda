import { Bot, Play, Settings2, TerminalSquare, WandSparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { QuickAction } from '@shared/project-settings';
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@renderer/lib/ui/context-menu';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@renderer/lib/ui/dropdown-menu';

export interface ProjectQuickActionsMenuActions {
  /** Warm the project settings when a menu surface opens. */
  onQuickActionsMenuOpen?: () => void;
  onCaptureAutomation?: () => void;
  onManageQuickActions?: () => void;
  quickActions?: QuickAction[];
  canRunQuickAction?: (action: QuickAction) => boolean;
  isQuickActionRunning?: (action: QuickAction) => boolean;
  onRunQuickAction?: (action: QuickAction) => void;
  onNavigateQuickAction?: (action: QuickAction) => void;
}

function QuickActionMenuItemContent({
  action,
  running,
}: {
  action: QuickAction;
  running: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      {action.kind === 'command' ? (
        <TerminalSquare className="size-4" />
      ) : (
        <Bot className="size-4" />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{action.label}</span>
        <span className="truncate text-[10px] text-foreground-passive">
          {t(
            action.kind === 'command'
              ? 'sidebar.captureAutomation.commandKind'
              : 'sidebar.captureAutomation.skillKind'
          )}
          {' · '}
          {action.command}
        </span>
      </span>
      {running ? (
        <span className="ml-2 flex shrink-0 items-center gap-1 text-[10px] text-success">
          <span className="size-1.5 rounded-full bg-success motion-safe:animate-pulse" />
          {t('sidebar.captureAutomation.running')}
        </span>
      ) : null}
    </>
  );
}

function quickActionMenuState(actions: ProjectQuickActionsMenuActions, action: QuickAction) {
  const running = actions.isQuickActionRunning?.(action) === true;
  return {
    running,
    disabled: running
      ? !actions.onNavigateQuickAction
      : !actions.onRunQuickAction || actions.canRunQuickAction?.(action) === false,
    select: () => {
      if (running) actions.onNavigateQuickAction?.(action);
      else actions.onRunQuickAction?.(action);
    },
  };
}

export function ProjectQuickActionsContextSubmenu({
  actions,
}: {
  actions: ProjectQuickActionsMenuActions;
}) {
  const { t } = useTranslation();
  const quickActions = actions.quickActions ?? [];
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <Play className="size-4" />
        {t('sidebar.captureAutomation.menuLabel')}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="min-w-72 max-w-96">
        {quickActions.length > 0
          ? quickActions.map((action) => {
              const state = quickActionMenuState(actions, action);
              return (
                <ContextMenuItem
                  key={action.id}
                  disabled={state.disabled}
                  onClick={(event) => {
                    event.stopPropagation();
                    state.select();
                  }}
                >
                  <QuickActionMenuItemContent action={action} running={state.running} />
                </ContextMenuItem>
              );
            })
          : null}
        {quickActions.length === 0 ? (
          <ContextMenuItem disabled>{t('sidebar.captureAutomation.noCommands')}</ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={(event) => {
            event.stopPropagation();
            actions.onCaptureAutomation?.();
          }}
        >
          <WandSparkles className="size-4" />
          {t('sidebar.captureAutomation.createLabel')}
        </ContextMenuItem>
        <ContextMenuItem
          onClick={(event) => {
            event.stopPropagation();
            actions.onManageQuickActions?.();
          }}
        >
          <Settings2 className="size-4" />
          {t('projects.quickActions.manage')}
        </ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

export function ProjectQuickActionsDropdownSubmenu({
  actions,
}: {
  actions: ProjectQuickActionsMenuActions;
}) {
  const { t } = useTranslation();
  const quickActions = actions.quickActions ?? [];
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Play className="size-4" />
        {t('sidebar.captureAutomation.menuLabel')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-72 max-w-96">
        {quickActions.length > 0
          ? quickActions.map((action) => {
              const state = quickActionMenuState(actions, action);
              return (
                <DropdownMenuItem
                  key={action.id}
                  disabled={state.disabled}
                  onClick={(event) => {
                    event.stopPropagation();
                    state.select();
                  }}
                >
                  <QuickActionMenuItemContent action={action} running={state.running} />
                </DropdownMenuItem>
              );
            })
          : null}
        {quickActions.length === 0 ? (
          <DropdownMenuItem disabled>{t('sidebar.captureAutomation.noCommands')}</DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={(event) => {
            event.stopPropagation();
            actions.onCaptureAutomation?.();
          }}
        >
          <WandSparkles className="size-4" />
          {t('sidebar.captureAutomation.createLabel')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={(event) => {
            event.stopPropagation();
            actions.onManageQuickActions?.();
          }}
        >
          <Settings2 className="size-4" />
          {t('projects.quickActions.manage')}
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
