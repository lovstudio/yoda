import { ArrowLeft, ArrowRight } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { getTaskView } from '@renderer/features/tasks/stores/task-selectors';
import { appState } from '@renderer/lib/stores/app-state';
import type { HistoryEntry } from '@renderer/lib/stores/navigation-history-store';
import { Button } from '@renderer/lib/ui/button';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';

type NavButtonsProps = {
  children?: ReactNode;
};

type NavIconButtonProps = ComponentProps<typeof Button>;

export function NavIconButton({ className, ...props }: NavIconButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "relative size-7 overflow-visible p-0 hover:bg-transparent active:scale-[0.97] active:bg-transparent before:absolute before:left-1/2 before:top-1/2 before:h-7 before:w-[30px] before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-md before:bg-transparent before:transition-colors before:content-[''] hover:before:bg-background-tertiary-3 active:before:bg-background-tertiary-2 data-popup-open:before:bg-background-tertiary-3 disabled:active:scale-100 [&_svg]:relative [&_svg]:z-10 [&_svg]:transition-[filter] hover:[&_svg]:drop-shadow-[0_1px_1px_rgb(0_0_0_/_0.24)] data-popup-open:[&_svg]:drop-shadow-[0_1px_1px_rgb(0_0_0_/_0.24)]",
        className
      )}
      {...props}
    />
  );
}

export function applyHistoryEntry(entry: HistoryEntry): void {
  if (entry.kind === 'view') {
    appState.navigation._applyNavigation(entry.viewId, entry.params);
  } else {
    appState.navigation._applyNavigation('task', {
      projectId: entry.projectId,
      taskId: entry.taskId,
    });
    getTaskView(entry.projectId, entry.taskId)?.tabManager.setActiveTab(entry.tabId);
  }
}

export const NavButtons = observer(function NavButtons({ children }: NavButtonsProps) {
  const { t } = useTranslation();
  const { canGoBack, canGoForward } = appState.history;
  return (
    <TooltipProvider delay={300}>
      <div className="[-webkit-app-region:no-drag] flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <NavIconButton
                disabled={!canGoBack}
                onClick={() => appState.history.back(applyHistoryEntry)}
              />
            }
          >
            <ArrowLeft className="h-4 w-4" />
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>
            {t('navigation.goBack')}
            <ShortcutHint settingsKey="navigateBack" />
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <NavIconButton
                disabled={!canGoForward}
                onClick={() => appState.history.forward(applyHistoryEntry)}
              />
            }
          >
            <ArrowRight className="h-4 w-4" />
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>
            {t('navigation.goForward')}
            <ShortcutHint settingsKey="navigateForward" />
          </TooltipContent>
        </Tooltip>
        {children}
      </div>
    </TooltipProvider>
  );
});
