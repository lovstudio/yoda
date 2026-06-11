import {
  Archive,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleDot,
  EyeOff,
  ListRestart,
  Settings2,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  SidebarBranchDisplay,
  SidebarTaskGroupBy,
  SidebarTaskSortBy,
} from '@shared/view-state';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Separator } from '@renderer/lib/ui/separator';
import { Switch } from '@renderer/lib/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { SidebarSectionHeader } from './sidebar-primitives';
import type { ProjectTypeFilter } from './sidebar-store';

export const ProjectsGroupLabel = observer(function ProjectsGroupLabel() {
  const { t } = useTranslation();

  return (
    <SidebarSectionHeader
      label={t('sidebar.projects')}
      collapsed={sidebarStore.projectsCollapsed}
      onToggle={() => sidebarStore.toggleProjectsCollapsed()}
    />
  );
});

/**
 * View-options icon button next to the workspace switcher: opens the sidebar
 * task-list display panel. Highlighted while any setting deviates from the
 * defaults.
 */
export const ProjectsSettingsMenu = observer(function ProjectsSettingsMenu() {
  const { t } = useTranslation();
  const { value: homeDraft } = useAppSettingsKey('homeDraft');
  const expressMode = homeDraft?.expressMode ?? false;
  const customized =
    sidebarStore.projectTypeFilter !== 'all' ||
    sidebarStore.taskSortBy !== 'updated-at' ||
    sidebarStore.taskGroupBy !== 'project' ||
    sidebarStore.taskBranchDisplay !== 'compact' ||
    sidebarStore.hideProjectsWithoutActiveTasks ||
    sidebarStore.sortNeedsReviewLast ||
    sidebarStore.sortArchivingLast ||
    expressMode;

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  data-active={customized || undefined}
                  className="opacity-0 transition-opacity group-hover/ws:opacity-100 data-popup-open:opacity-100 hover:bg-background-tertiary-2 text-foreground-muted hover:text-foreground data-[active=true]:text-foreground"
                />
              }
            />
          }
        >
          <Settings2 />
        </TooltipTrigger>
        <TooltipContent>{t('workspaces.viewOptions')}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-72 gap-0 p-1.5">
        <ProjectsSettingsPanel />
      </PopoverContent>
    </Popover>
  );
});

/**
 * Sidebar task-list display panel, Linear-style: layout choices as compact
 * label + control rows, boolean rules as switch rows (visually distinct from
 * single-choice selects), bulk actions in a footer. Lives in a popover so
 * multiple settings can be adjusted without the panel closing.
 */
const ProjectsSettingsPanel = observer(function ProjectsSettingsPanel() {
  const { t } = useTranslation();
  const { value: homeDraft, update: updateHomeDraft } = useAppSettingsKey('homeDraft');
  const expressMode = homeDraft?.expressMode ?? false;

  const groupByLabels: Record<SidebarTaskGroupBy, string> = {
    project: t('sidebar.groupByProject'),
    none: t('sidebar.groupByNone'),
    type: t('sidebar.groupByType'),
    activity: t('sidebar.groupByActivity'),
  };

  return (
    <div className="flex flex-col">
      <PanelRow label={t('sidebar.groupBy')}>
        <Select
          value={sidebarStore.taskGroupBy}
          onValueChange={(value) => sidebarStore.applyGroupBy(value as SidebarTaskGroupBy)}
        >
          <SelectTrigger size="sm" className="text-xs">
            <SelectValue>{(value: SidebarTaskGroupBy) => groupByLabels[value]}</SelectValue>
          </SelectTrigger>
          <SelectContent align="end">
            {(Object.keys(groupByLabels) as SidebarTaskGroupBy[]).map((value) => (
              <SelectItem key={value} value={value}>
                {groupByLabels[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PanelRow>
      <PanelRow label={t('sidebar.sortBy')}>
        <ToggleGroup
          size="xs"
          multiple={false}
          value={[sidebarStore.taskSortBy]}
          onValueChange={([value]) => {
            if (value) sidebarStore.applySort(value as SidebarTaskSortBy);
          }}
        >
          <ToggleGroupItem value="created-at">{t('sidebar.sortByCreatedAt')}</ToggleGroupItem>
          <ToggleGroupItem value="updated-at">{t('sidebar.sortByUpdatedAt')}</ToggleGroupItem>
        </ToggleGroup>
      </PanelRow>
      <PanelRow label={t('sidebar.branchDisplay')}>
        <ToggleGroup
          size="xs"
          multiple={false}
          value={[sidebarStore.taskBranchDisplay]}
          onValueChange={([value]) => {
            if (value) sidebarStore.setTaskBranchDisplay(value as SidebarBranchDisplay);
          }}
        >
          <ToggleGroupItem value="hidden">{t('sidebar.branchDisplayHidden')}</ToggleGroupItem>
          <ToggleGroupItem value="compact">{t('sidebar.branchDisplayCompact')}</ToggleGroupItem>
          <ToggleGroupItem value="full">{t('sidebar.branchDisplayFull')}</ToggleGroupItem>
        </ToggleGroup>
      </PanelRow>
      <PanelRow label={t('sidebar.filterByType')}>
        <ToggleGroup
          size="xs"
          multiple={false}
          value={[sidebarStore.projectTypeFilter]}
          onValueChange={([value]) => {
            if (value) sidebarStore.setProjectTypeFilter(value as ProjectTypeFilter);
          }}
        >
          <ToggleGroupItem value="all">{t('sidebar.filterAllShort')}</ToggleGroupItem>
          <ToggleGroupItem value="local">{t('sidebar.filterLocalShort')}</ToggleGroupItem>
          <ToggleGroupItem value="ssh">{t('sidebar.filterSshShort')}</ToggleGroupItem>
        </ToggleGroup>
      </PanelRow>
      <PanelSeparator />
      <SectionLabel>{t('sidebar.demoteRules')}</SectionLabel>
      <SwitchRow
        icon={CircleDot}
        label={t('sidebar.demoteNeedsReview')}
        description={t('sidebar.sortNeedsReviewLastDescription')}
        checked={sidebarStore.sortNeedsReviewLast}
        onCheckedChange={(checked) => sidebarStore.setSortNeedsReviewLast(checked)}
      />
      <SwitchRow
        icon={Archive}
        label={t('sidebar.demoteArchiving')}
        description={t('sidebar.sortArchivingLastDescription')}
        checked={sidebarStore.sortArchivingLast}
        onCheckedChange={(checked) => sidebarStore.setSortArchivingLast(checked)}
      />
      <PanelSeparator />
      <SwitchRow
        icon={EyeOff}
        label={t('sidebar.hideProjectsWithoutActiveTasks')}
        description={t('sidebar.hideProjectsWithoutActiveTasksDescription')}
        checked={sidebarStore.hideProjectsWithoutActiveTasks}
        onCheckedChange={(checked) => sidebarStore.setHideProjectsWithoutActiveTasks(checked)}
      />
      <SwitchRow
        icon={Zap}
        label={t('sidebar.expressMode')}
        description={t('sidebar.expressModeDescription')}
        checked={expressMode}
        onCheckedChange={(checked) => updateHomeDraft({ expressMode: checked })}
      />
      <PanelSeparator />
      <div className="grid grid-cols-2 gap-1">
        <Button
          variant="ghost"
          size="xs"
          className="justify-start text-foreground-muted hover:text-foreground"
          onClick={() => sidebarStore.expandAllProjects()}
        >
          <ChevronsUpDown />
          {t('sidebar.expandAll')}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          className="justify-start text-foreground-muted hover:text-foreground"
          onClick={() => sidebarStore.collapseAllProjects()}
        >
          <ChevronsDownUp />
          {t('sidebar.collapseAll')}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          className="col-span-2 justify-start text-foreground-muted hover:text-foreground"
          onClick={() => sidebarStore.clearManualTaskOrder()}
        >
          <ListRestart />
          {t('sidebar.clearManualOrder')}
        </Button>
      </div>
    </div>
  );
});

function PanelRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex h-8 items-center justify-between gap-2 px-2">
      <span className="text-xs text-foreground-muted">{label}</span>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 pt-1 pb-0.5 text-xs font-medium text-foreground-muted">{children}</div>
  );
}

function PanelSeparator() {
  return <Separator className="my-1.5 -mx-1.5 w-auto" />;
}

function SwitchRow({
  icon: Icon,
  label,
  description,
  checked,
  onCheckedChange,
}: {
  icon: LucideIcon;
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  // The row itself toggles (big hit target); the switch is the focusable
  // control and stops propagation so a direct click doesn't double-toggle.
  const row = (
    <div
      className="flex h-8 cursor-default items-center gap-2 rounded-sm px-2 text-sm hover:bg-background-quaternary-1"
      onClick={() => onCheckedChange(!checked)}
    >
      <Icon className="size-3.5 shrink-0 text-foreground-muted" />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <Switch
        size="sm"
        checked={checked}
        onCheckedChange={onCheckedChange}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );

  if (!description) return row;
  return (
    <Tooltip>
      <TooltipTrigger render={row} />
      <TooltipContent side="left" align="start" className="max-w-72">
        {description}
      </TooltipContent>
    </Tooltip>
  );
}
