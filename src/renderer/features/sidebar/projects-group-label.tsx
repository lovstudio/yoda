import {
  Archive,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  EyeOff,
  FolderTree,
  ListRestart,
  MessageSquareOff,
  Settings2,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_SIDEBAR_TASK_GROUP_VISIBLE_LIMIT,
  DEFAULT_SIDEBAR_TASK_PRIORITY_ORDER,
  SIDEBAR_TASK_GROUP_VISIBLE_LIMIT_OPTIONS,
  type SidebarBranchDisplay,
  type SidebarTaskGroupBy,
  type SidebarTaskGroupVisibleLimit,
  type SidebarTaskSortBy,
} from '@shared/view-state';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { showModal } from '@renderer/lib/modal/modal-provider';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
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
  const { navigate } = useNavigate();

  return (
    <ContextMenu>
      <ContextMenuTrigger className="block">
        <SidebarSectionHeader
          label={t('sidebar.projects')}
          collapsed={sidebarStore.projectsCollapsed}
          onToggle={() => sidebarStore.toggleProjectsCollapsed()}
        />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => navigate('projectsOverview')}>
          <FolderTree className="size-4" />
          {t('sidebar.projectsOverview')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => sidebarStore.expandAllProjects()}>
          <ChevronsUpDown className="size-4" />
          {t('sidebar.expandAll')}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => sidebarStore.collapseAllProjects()}>
          <ChevronsDownUp className="size-4" />
          {t('sidebar.collapseAll')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

/**
 * View-options icon in the sidebar's top navigation buttons: opens the
 * task-list display panel. Highlighted while any setting deviates from the
 * defaults.
 */
interface ProjectsSettingsMenuProps {
  renderTrigger: (
    props: ButtonHTMLAttributes<HTMLButtonElement> & { 'data-customized'?: boolean }
  ) => ReactElement;
}

export const ProjectsSettingsMenu = observer(function ProjectsSettingsMenu({
  renderTrigger,
}: ProjectsSettingsMenuProps) {
  const { t } = useTranslation();
  const { value: homeDraft } = useAppSettingsKey('homeDraft');
  const { value: interfaceSettings } = useAppSettingsKey('interface');
  const expressMode = homeDraft?.expressMode ?? false;
  const newTaskOpenMode = interfaceSettings?.newTaskOpenMode ?? 'home';
  const customized =
    sidebarStore.projectTypeFilter !== 'all' ||
    sidebarStore.taskSortBy !== 'updated-at' ||
    sidebarStore.taskGroupBy !== 'project' ||
    sidebarStore.taskPriorityMode ||
    sidebarStore.taskPriorityOrder.some(
      (group, index) => group !== DEFAULT_SIDEBAR_TASK_PRIORITY_ORDER[index]
    ) ||
    sidebarStore.taskGroupVisibleLimit !== DEFAULT_SIDEBAR_TASK_GROUP_VISIBLE_LIMIT ||
    sidebarStore.taskBranchDisplay !== 'compact' ||
    sidebarStore.hideProjectsWithoutActiveTasks ||
    sidebarStore.hideTasksWithoutActiveConversations ||
    sidebarStore.sortArchivingLast ||
    newTaskOpenMode !== 'home' ||
    expressMode;

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={renderTrigger({
                'aria-label': t('workspaces.viewOptions'),
                'data-customized': customized || undefined,
                className: 'data-[customized=true]:text-foreground',
              })}
            />
          }
        >
          <Settings2 className="h-4 w-4" />
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={8}>
          {t('workspaces.viewOptions')}
        </TooltipContent>
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
  const { value: interfaceSettings, update: updateInterface } = useAppSettingsKey('interface');
  const expressMode = homeDraft?.expressMode ?? false;
  const newTaskOpenMode = interfaceSettings?.newTaskOpenMode ?? 'home';

  const groupByLabels: Record<SidebarTaskGroupBy, string> = {
    project: t('sidebar.groupByProject'),
    none: t('sidebar.groupByNone'),
    type: t('sidebar.groupByType'),
    activity: t('sidebar.groupByActivity'),
  };

  return (
    <div className="flex flex-col">
      <PanelRow label={t('sidebar.newTaskOpenMode')}>
        <ToggleGroup
          size="xs"
          multiple={false}
          value={[newTaskOpenMode]}
          onValueChange={([value]) => {
            if (value === 'home' || value === 'modal') {
              updateInterface({ newTaskOpenMode: value });
            }
          }}
        >
          <ToggleGroupItem value="home">{t('sidebar.newTaskOpenHome')}</ToggleGroupItem>
          <ToggleGroupItem value="modal">{t('sidebar.newTaskOpenModal')}</ToggleGroupItem>
        </ToggleGroup>
      </PanelRow>
      <PanelSeparator />
      {!sidebarStore.taskPriorityMode && (
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
      )}
      <PanelRow label={t('sidebar.collapseThreshold')}>
        <Select
          value={sidebarStore.taskGroupVisibleLimit}
          onValueChange={(value) => {
            if (value !== null) {
              sidebarStore.setTaskGroupVisibleLimit(value as SidebarTaskGroupVisibleLimit);
            }
          }}
        >
          <SelectTrigger size="sm" className="text-xs">
            <SelectValue>
              {(value: SidebarTaskGroupVisibleLimit) =>
                t('sidebar.collapseThresholdOption', { count: value })
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="end">
            {SIDEBAR_TASK_GROUP_VISIBLE_LIMIT_OPTIONS.map((value) => (
              <SelectItem key={value} value={value}>
                {t('sidebar.collapseThresholdOption', { count: value })}
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
      <PanelSwitchRow
        id="sidebar-priority-mode"
        label={t('sidebar.priorityMode')}
        description={t('sidebar.priorityModeDescription')}
        checked={sidebarStore.taskPriorityMode}
        onCheckedChange={(checked) => sidebarStore.setTaskPriorityMode(checked)}
      />
      {sidebarStore.taskPriorityMode && <PriorityOrderCard />}
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
        icon={MessageSquareOff}
        label={t('sidebar.hideTasksWithoutActiveConversations')}
        description={t('sidebar.hideTasksWithoutActiveConversationsDescription')}
        checked={sidebarStore.hideTasksWithoutActiveConversations}
        onCheckedChange={(checked) => sidebarStore.setHideTasksWithoutActiveConversations(checked)}
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
        {!sidebarStore.taskPriorityMode && (
          <Button
            variant="ghost"
            size="xs"
            className="col-span-2 justify-start text-foreground-muted hover:text-foreground"
            onClick={() => sidebarStore.clearManualTaskOrder()}
          >
            <ListRestart />
            {t('sidebar.clearManualOrder')}
          </Button>
        )}
      </div>
    </div>
  );
});

const PriorityOrderCard = observer(function PriorityOrderCard() {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      aria-haspopup="dialog"
      className="group mx-2 flex h-8 w-[calc(100%-1rem)] items-center gap-2 rounded-sm bg-background-tertiary-1/45 px-2 text-left text-xs text-foreground-muted outline-none transition-colors hover:bg-background-tertiary-1 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
      onClick={() => showModal('priorityOrderModal', {})}
    >
      <span className="min-w-0 flex-1 truncate">{t('sidebar.priorityOrder')}</span>
      <span className="shrink-0 text-[11px] text-foreground-passive">
        {t('sidebar.priorityOrderSummary', { count: sidebarStore.taskPriorityOrder.length })}
      </span>
      <ChevronRight className="size-3 shrink-0 text-foreground-passive transition-transform group-hover:translate-x-0.5 group-hover:text-foreground-muted" />
    </button>
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

function PanelSwitchRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const labelElement = (
    <label htmlFor={id} className="cursor-default text-xs text-foreground-muted">
      {label}
    </label>
  );

  return (
    <div className="flex h-8 items-center justify-between gap-2 px-2">
      {description ? (
        <Tooltip>
          <TooltipTrigger render={labelElement} />
          <TooltipContent side="left" align="start" className="max-w-72">
            {description}
          </TooltipContent>
        </Tooltip>
      ) : (
        labelElement
      )}
      <Switch
        id={id}
        size="sm"
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={label}
      />
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
