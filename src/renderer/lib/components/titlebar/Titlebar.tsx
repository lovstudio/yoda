import { PanelLeft } from 'lucide-react';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AppTabStrip } from '@renderer/app/app-tab-strip';
import { NavButtons, NavIconButton } from '@renderer/lib/components/nav-buttons';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';

export function Titlebar({
  leftSlot,
  rightSlot,
  hosted = false,
}: {
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
  /**
   * Hosted (non-primary, split-view extra) panes must not show the global
   * AppTabStrip / nav cluster — those always reflect the routed task. The pane
   * keeps only its own task controls (rightSlot) and stays draggable.
   */
  hosted?: boolean;
}) {
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
        <div className="flex w-full min-w-0 items-center">
          <div className="flex shrink-0 items-center justify-start [-webkit-app-region:no-drag]">
            {!isLeftOpen && !hosted && (
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
          {/* App tabs share the titlebar row (browser model); blank space stays
              draggable. Hosted panes drop the global strip — they switch tabs
              via their own sidebar — keeping only a draggable spacer. */}
          <div className="min-w-0 flex-1 px-2">{hosted ? null : <AppTabStrip />}</div>
          <div className="flex shrink-0 items-center justify-end [-webkit-app-region:no-drag]">
            {rightSlot}
          </div>
        </div>
      </div>
    </header>
  );
}
