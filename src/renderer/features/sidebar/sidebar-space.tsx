import { PanelLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavButtons, NavIconButton } from '@renderer/lib/components/nav-buttons';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';

export function SidebarSpace() {
  const { t } = useTranslation();
  const { isLeftOpen, setCollapsed } = useWorkspaceLayoutContext();
  return (
    <div className="[-webkit-app-region:drag] flex h-10 w-full items-center justify-end px-2">
      <NavButtons>
        <Tooltip>
          <TooltipTrigger
            render={<NavIconButton onClick={() => setCollapsed('left', isLeftOpen)} />}
          >
            <PanelLeft className="h-4 w-4" />
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>
            {t('navigation.toggleLeftSidebar')}
            <ShortcutHint settingsKey="toggleLeftSidebar" />
          </TooltipContent>
        </Tooltip>
      </NavButtons>
    </div>
  );
}
