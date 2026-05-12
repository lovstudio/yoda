import { ChevronsDownUp, ChevronsUpDown, ListRestart, Settings2, Zap } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { SidebarSectionHeader } from './sidebar-primitives';

export const ProjectsGroupLabel = observer(function ProjectsGroupLabel() {
  const { t } = useTranslation();
  const { value: homeDraft, update: updateHomeDraft } = useAppSettingsKey('homeDraft');
  const expressMode = homeDraft?.expressMode ?? false;
  const customized =
    sidebarStore.projectTypeFilter !== 'all' ||
    sidebarStore.taskSortBy !== 'created-at' ||
    expressMode;

  return (
    <SidebarSectionHeader
      label={t('sidebar.projects')}
      collapsed={sidebarStore.projectsCollapsed}
      onToggle={() => sidebarStore.toggleProjectsCollapsed()}
      rightSlot={
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      data-active={customized || undefined}
                      className="hover:bg-background-tertiary-2 text-foreground-muted hover:text-foreground data-[active=true]:text-foreground"
                    />
                  }
                />
              }
            >
              <Settings2 />
            </TooltipTrigger>
            <TooltipContent>{t('sidebar.more')}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t('sidebar.sortBy')}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={sidebarStore.taskSortBy}>
                <DropdownMenuRadioItem
                  value="created-at"
                  onClick={() => sidebarStore.applySort('created-at')}
                >
                  {t('sidebar.sortByCreatedAt')}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem
                  value="updated-at"
                  onClick={() => sidebarStore.applySort('updated-at')}
                >
                  {t('sidebar.sortByUpdatedAt')}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t('sidebar.filterByType')}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={sidebarStore.projectTypeFilter}>
                <DropdownMenuRadioItem
                  value="all"
                  onClick={() => sidebarStore.setProjectTypeFilter('all')}
                >
                  {t('sidebar.filterAll')}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem
                  value="local"
                  onClick={() => sidebarStore.setProjectTypeFilter('local')}
                >
                  {t('sidebar.filterLocal')}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem
                  value="ssh"
                  onClick={() => sidebarStore.setProjectTypeFilter('ssh')}
                >
                  {t('sidebar.filterSsh')}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuCheckboxItem
                checked={expressMode}
                onCheckedChange={(checked) => updateHomeDraft({ expressMode: checked === true })}
              >
                <Zap className="size-3.5" />
                {t('sidebar.expressMode')}
              </DropdownMenuCheckboxItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => sidebarStore.expandAllProjects()}>
                <ChevronsUpDown className="size-3.5" />
                {t('sidebar.expandAll')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sidebarStore.collapseAllProjects()}>
                <ChevronsDownUp className="size-3.5" />
                {t('sidebar.collapseAll')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sidebarStore.clearManualTaskOrder()}>
                <ListRestart className="size-3.5" />
                {t('sidebar.clearManualOrder')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  );
});
