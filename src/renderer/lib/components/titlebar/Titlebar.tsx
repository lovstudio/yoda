import { PanelLeft } from 'lucide-react';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavButtons, NavIconButton } from '@renderer/lib/components/nav-buttons';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';

export function Titlebar({ leftSlot, rightSlot }: { leftSlot?: ReactNode; rightSlot?: ReactNode }) {
  const { t } = useTranslation();
  const { setCollapsed, isLeftOpen } = useWorkspaceLayoutContext();
  return (
    <header
      className={cn(
        'flex h-10 shrink-0 items-center bg-background-secondary pr-2 border-b border-border [-webkit-app-region:drag] dark:bg-background',
        !isLeftOpen && 'pl-18'
      )}
    >
      <div className="pointer-events-auto flex w-full items-center gap-1">
        {!isLeftOpen && <div className="[-webkit-app-region:no-drag]"></div>}
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center justify-start [-webkit-app-region:no-drag]">
            {!isLeftOpen && (
              <>
                <TooltipProvider delay={300}>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <NavIconButton
                          className="ml-2 size-7 border-none"
                          onClick={() => setCollapsed('left', isLeftOpen)}
                        />
                      }
                    >
                      <PanelLeft className="h-4 w-4" />
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={8}>
                      {t('navigation.toggleLeftSidebar')}
                      <ShortcutHint settingsKey="toggleLeftSidebar" />
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <NavButtons />
              </>
            )}
            {leftSlot}
          </div>
          <div className="flex items-center justify-end [-webkit-app-region:no-drag]">
            {rightSlot}
          </div>
        </div>
      </div>
    </header>
  );
}
