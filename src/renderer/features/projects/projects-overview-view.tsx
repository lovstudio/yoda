import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  FolderClosed,
  FolderInput,
  FolderTree,
  Settings2,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { projectDisplayName, type LocalProject, type SshProject } from '@shared/projects';
import type { ProjectUsage } from '@shared/stats';
import type { ProjectStore } from '@renderer/features/projects/stores/project';
import {
  asMounted,
  getProjectManagerStore,
} from '@renderer/features/projects/stores/project-selectors';
import { isRegistered } from '@renderer/features/tasks/stores/task';
import { useUsageOverview } from '@renderer/features/usage/useUsageOverview';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { useLocalStorage } from '@renderer/lib/hooks/useLocalStorage';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { formatCompactNumber } from '@renderer/utils/format-compact-number';
import { cn } from '@renderer/utils/utils';

const ARCHIVED_QUERY_KEY = ['archivedProjects'];
const COLUMN_STORAGE_KEY = 'yoda:projects-overview:visible-columns';
const PROJECT_OVERVIEW_COLUMNS = [
  'kind',
  'path',
  'activeTasks',
  'usage',
  'createdAt',
  'updatedAt',
] as const;
type ProjectOverviewColumnId = (typeof PROJECT_OVERVIEW_COLUMNS)[number];

const DEFAULT_VISIBLE_COLUMNS: ProjectOverviewColumnId[] = [
  'activeTasks',
  'usage',
  'updatedAt',
  'createdAt',
];

const PROJECT_OVERVIEW_COLUMN_WIDTHS: Record<ProjectOverviewColumnId, string> = {
  kind: '5.5rem',
  path: 'minmax(13rem, 1.15fr)',
  activeTasks: '6.5rem',
  usage: '7rem',
  createdAt: '8.5rem',
  updatedAt: '8.5rem',
};

function projectIcon(isSsh: boolean) {
  return isSsh ? FolderInput : FolderClosed;
}

function activeTaskCount(store: ProjectStore): number {
  const mounted = asMounted(store);
  if (!mounted) return 0;
  return Array.from(mounted.taskManager.tasks.values()).filter(
    (task) => isRegistered(task) && !task.data.archivedAt
  ).length;
}

function normalizeVisibleColumns(value: unknown): ProjectOverviewColumnId[] {
  if (!Array.isArray(value)) return DEFAULT_VISIBLE_COLUMNS;
  const visible = new Set(value);
  return PROJECT_OVERVIEW_COLUMNS.filter((column) => visible.has(column));
}

function setColumnVisibility(
  value: unknown,
  column: ProjectOverviewColumnId,
  visible: boolean
): ProjectOverviewColumnId[] {
  const next = new Set(normalizeVisibleColumns(value));
  if (visible) next.add(column);
  else next.delete(column);
  return PROJECT_OVERVIEW_COLUMNS.filter((item) => next.has(item));
}

function projectGridTemplate(visibleColumns: readonly ProjectOverviewColumnId[]): string {
  return [
    'minmax(14rem, 1.6fr)',
    ...visibleColumns.map((column) => PROJECT_OVERVIEW_COLUMN_WIDTHS[column]),
    'auto',
  ].join(' ');
}

/**
 * Cross-project overview reached by right-clicking the sidebar "Projects"
 * group label. Lists every registered project plus every archived one, so the
 * full project situation is visible in one place — and archived projects can
 * be restored or permanently removed without digging through settings.
 */
const ProjectsOverview = observer(function ProjectsOverview() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { navigate } = useNavigate();
  const queryClient = useQueryClient();
  const showConfirmRemove = useShowModal('confirmActionModal');
  const [storedVisibleColumns, setStoredVisibleColumns] = useLocalStorage<
    ProjectOverviewColumnId[]
  >(COLUMN_STORAGE_KEY, DEFAULT_VISIBLE_COLUMNS);
  const visibleColumns = normalizeVisibleColumns(storedVisibleColumns);

  const { data: archived = [], isLoading } = useQuery({
    queryKey: ARCHIVED_QUERY_KEY,
    queryFn: () => rpc.projects.getArchivedProjects(),
  });
  const {
    data: usageOverview,
    isLoading: isUsageLoading,
    isError: isUsageError,
  } = useUsageOverview();
  const usageByProject = new Map<string, ProjectUsage>(
    (usageOverview?.byProject ?? [])
      .filter((entry) => !entry.external)
      .map((entry) => [entry.projectId, entry])
  );

  const active = Array.from(getProjectManagerStore().projects.values()).filter(
    (store) => store.state !== 'unregistered' && !store.data?.isInternal
  );
  const setColumnVisible = (column: ProjectOverviewColumnId, visible: boolean) => {
    setStoredVisibleColumns((current) => setColumnVisibility(current, column, visible));
  };

  const invalidateArchived = () => queryClient.invalidateQueries({ queryKey: ARCHIVED_QUERY_KEY });

  const handleArchive = async (projectId: string) => {
    try {
      await getProjectManagerStore().archiveProject(projectId);
      await invalidateArchived();
    } catch (err) {
      toast({
        title: t('projectsOverview.archiveFailed'),
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
  };

  const handleUnarchive = async (projectId: string) => {
    try {
      await getProjectManagerStore().unarchiveProject(projectId);
      await invalidateArchived();
    } catch (err) {
      toast({
        title: t('settings.archivedProjects.unarchiveFailed'),
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
  };

  const handleRemove = (project: LocalProject | SshProject) => {
    showConfirmRemove({
      title: t('projects.deleteProjectTitle'),
      description: t('projects.deleteProjectDescription', { name: projectDisplayName(project) }),
      confirmLabel: t('projects.removeProject'),
      onSuccess: () => {
        void rpc.projects.deleteProject(project.id).then(() => void invalidateArchived());
      },
    });
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-8 py-8">
        <header className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <FolderTree className="size-4 text-foreground-muted" />
            <h1 className="text-lg font-semibold">{t('projectsOverview.title')}</h1>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t('projectsOverview.subtitle')}
          </p>
        </header>

        <section className="flex flex-col gap-2">
          <SectionTitle label={t('projectsOverview.active')} count={active.length} />
          {active.length === 0 ? (
            <EmptyRow label={t('projectsOverview.emptyActive')} />
          ) : (
            <ProjectTable visibleColumns={visibleColumns} onColumnVisibleChange={setColumnVisible}>
              {active.map((store) => {
                const data = store.data;
                if (!data) return null;
                const count = activeTaskCount(store);
                return (
                  <ProjectTableRow
                    key={store.id}
                    project={data}
                    name={store.displayName}
                    activeTaskCount={count}
                    usage={usageByProject.get(store.id)}
                    isUsageLoading={isUsageLoading}
                    isUsageError={isUsageError}
                    visibleColumns={visibleColumns}
                    onOpen={() => navigate('project', { projectId: store.id })}
                    actions={
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleArchive(store.id)}
                        >
                          <Archive className="size-3" />
                          {t('sidebar.archiveProject')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-foreground-destructive hover:text-foreground-destructive"
                          onClick={() => handleRemove(data)}
                        >
                          <Trash2 className="size-3" />
                          {t('projects.removeProject')}
                        </Button>
                      </>
                    }
                  />
                );
              })}
            </ProjectTable>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <SectionTitle label={t('projectsOverview.archived')} count={archived.length} />
          {isLoading ? (
            <EmptyRow label={t('settings.archivedProjects.loading')} />
          ) : archived.length === 0 ? (
            <EmptyRow label={t('settings.archivedProjects.empty')} />
          ) : (
            <ProjectTable visibleColumns={visibleColumns} onColumnVisibleChange={setColumnVisible}>
              {archived.map((project) => {
                return (
                  <ProjectTableRow
                    key={project.id}
                    project={project}
                    name={projectDisplayName(project)}
                    usage={usageByProject.get(project.id)}
                    isUsageLoading={isUsageLoading}
                    isUsageError={isUsageError}
                    visibleColumns={visibleColumns}
                    actions={
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleUnarchive(project.id)}
                        >
                          <ArchiveRestore className="size-3" />
                          {t('settings.archivedProjects.unarchive')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-foreground-destructive hover:text-foreground-destructive"
                          onClick={() => handleRemove(project)}
                        >
                          <Trash2 className="size-3" />
                          {t('projects.removeProject')}
                        </Button>
                      </>
                    }
                  />
                );
              })}
            </ProjectTable>
          )}
        </section>
      </div>
    </div>
  );
});

function ProjectTable({
  visibleColumns,
  onColumnVisibleChange,
  children,
}: {
  visibleColumns: ProjectOverviewColumnId[];
  onColumnVisibleChange: (column: ProjectOverviewColumnId, visible: boolean) => void;
  children: ReactNode;
}) {
  const template = projectGridTemplate(visibleColumns);
  return (
    <div className="overflow-x-auto rounded-xl border border-border/60 bg-muted/10 p-2">
      <div className="min-w-[720px]">
        <ProjectTableHeader
          visibleColumns={visibleColumns}
          onColumnVisibleChange={onColumnVisibleChange}
          template={template}
        />
        <div className="flex flex-col gap-1 pt-1">{children}</div>
      </div>
    </div>
  );
}

function ProjectTableHeader({
  visibleColumns,
  onColumnVisibleChange,
  template,
}: {
  visibleColumns: ProjectOverviewColumnId[];
  onColumnVisibleChange: (column: ProjectOverviewColumnId, visible: boolean) => void;
  template: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="grid items-center gap-3 border-b border-border/50 px-2 pb-1.5 text-[11px] font-medium text-foreground-passive"
      style={{ gridTemplateColumns: template }}
    >
      <span className="truncate">{t('projectsOverview.columns.name')}</span>
      {visibleColumns.map((column) => (
        <span
          key={column}
          className={cn(
            'truncate',
            (column === 'activeTasks' || column === 'usage') && 'text-right'
          )}
        >
          {t(`projectsOverview.columns.${column}`)}
        </span>
      ))}
      <div className="flex justify-end">
        <ProjectColumnsMenu
          visibleColumns={visibleColumns}
          onColumnVisibleChange={onColumnVisibleChange}
        />
      </div>
    </div>
  );
}

function ProjectColumnsMenu({
  visibleColumns,
  onColumnVisibleChange,
}: {
  visibleColumns: ProjectOverviewColumnId[];
  onColumnVisibleChange: (column: ProjectOverviewColumnId, visible: boolean) => void;
}) {
  const { t } = useTranslation();
  const visible = new Set(visibleColumns);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('projectsOverview.configureColumns')}
            title={t('projectsOverview.configureColumns')}
          >
            <Settings2 className="size-3.5" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>{t('projectsOverview.configureColumns')}</DropdownMenuLabel>
        {PROJECT_OVERVIEW_COLUMNS.map((column) => (
          <DropdownMenuCheckboxItem
            key={column}
            checked={visible.has(column)}
            onCheckedChange={(checked) => onColumnVisibleChange(column, checked === true)}
          >
            {t(`projectsOverview.columns.${column}`)}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProjectTableRow({
  project,
  name,
  activeTaskCount,
  usage,
  isUsageLoading,
  isUsageError,
  visibleColumns,
  onOpen,
  actions,
}: {
  project: LocalProject | SshProject;
  name: string;
  activeTaskCount?: number;
  usage?: ProjectUsage;
  isUsageLoading: boolean;
  isUsageError: boolean;
  visibleColumns: ProjectOverviewColumnId[];
  onOpen?: () => void;
  actions: ReactNode;
}) {
  const Icon = projectIcon(project.type === 'ssh');
  const template = projectGridTemplate(visibleColumns);
  const showPathInName = !visibleColumns.includes('path');
  return (
    <div
      className="grid items-center gap-3 rounded-md px-2 py-2 hover:bg-background-tertiary-1"
      style={{ gridTemplateColumns: template }}
    >
      <ProjectNameCell
        icon={Icon}
        name={name}
        path={project.path}
        showPath={showPathInName}
        onOpen={onOpen}
      />
      {visibleColumns.map((column) => (
        <ProjectColumnCell
          key={column}
          column={column}
          project={project}
          activeTaskCount={activeTaskCount}
          usage={usage}
          isUsageLoading={isUsageLoading}
          isUsageError={isUsageError}
        />
      ))}
      <div className="flex items-center justify-end gap-1">{actions}</div>
    </div>
  );
}

function ProjectNameCell({
  icon: Icon,
  name,
  path,
  showPath,
  onOpen,
}: {
  icon: LucideIcon;
  name: string;
  path: string;
  showPath: boolean;
  onOpen?: () => void;
}) {
  const content = (
    <>
      <Icon className="size-4 shrink-0 text-foreground-muted" />
      <span className="flex min-w-0 flex-col text-left">
        <span className="truncate text-sm text-foreground">{name}</span>
        {showPath && <span className="truncate text-xs text-foreground-muted">{path}</span>}
      </span>
    </>
  );
  if (!onOpen) {
    return <div className="flex min-w-0 items-center gap-3">{content}</div>;
  }
  return (
    <button type="button" className="flex min-w-0 items-center gap-3" onClick={onOpen}>
      {content}
    </button>
  );
}

function ProjectColumnCell({
  column,
  project,
  activeTaskCount,
  usage,
  isUsageLoading,
  isUsageError,
}: {
  column: ProjectOverviewColumnId;
  project: LocalProject | SshProject;
  activeTaskCount?: number;
  usage?: ProjectUsage;
  isUsageLoading: boolean;
  isUsageError: boolean;
}) {
  const { t } = useTranslation();
  switch (column) {
    case 'kind':
      return (
        <span className="truncate text-xs text-foreground-muted">
          {t(`projectsOverview.kind.${project.type}`)}
        </span>
      );
    case 'path':
      return (
        <span className="truncate font-mono text-xs text-foreground-muted" title={project.path}>
          {project.path}
        </span>
      );
    case 'activeTasks':
      return <ActiveTasksColumn count={activeTaskCount} />;
    case 'usage':
      return <ProjectUsageColumn usage={usage} isLoading={isUsageLoading} isError={isUsageError} />;
    case 'createdAt':
      return <ProjectDateColumn value={project.createdAt} />;
    case 'updatedAt':
      return <ProjectDateColumn value={project.updatedAt} />;
  }
}

function ActiveTasksColumn({ count }: { count?: number }) {
  const { t } = useTranslation();
  if (count === undefined) {
    return <span className="text-right font-mono text-xs text-foreground-passive">-</span>;
  }
  return (
    <span className="flex justify-end">
      <Badge variant="secondary" className="shrink-0">
        {t('projectsOverview.activeTasks', { count })}
      </Badge>
    </span>
  );
}

function ProjectDateColumn({ value }: { value: string }) {
  const { i18n } = useTranslation();
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) {
    return <span className="text-xs text-foreground-passive">-</span>;
  }
  const formatted = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
  return (
    <time
      className="truncate font-mono text-xs tabular-nums text-foreground-muted"
      dateTime={date.toISOString()}
      title={formatted}
    >
      {formatted}
    </time>
  );
}

function ProjectUsageColumn({
  usage,
  isLoading,
  isError,
}: {
  usage?: ProjectUsage;
  isLoading: boolean;
  isError: boolean;
}) {
  const { t } = useTranslation();
  const content = (() => {
    if (isError) {
      return {
        value: t('projectsOverview.usageUnavailable'),
        detail: undefined,
        title: t('usage.loadFailed'),
      };
    }
    if (isLoading) {
      return {
        value: t('projectsOverview.usageLoading'),
        detail: undefined,
        title: t('usage.loadingHint'),
      };
    }
    if (!usage) {
      return {
        value: t('projectsOverview.usageEmpty'),
        detail: undefined,
        title: t('projectsOverview.usageEmpty'),
      };
    }
    const tokens = formatCompactNumber(usage.tokens.total);
    const sessions = t('usage.sessionCount', { count: usage.sessionCount });
    return {
      value: t('projectsOverview.usageTokens', { value: tokens }),
      detail: sessions,
      title: `${tokens} - ${sessions}`,
    };
  })();

  return (
    <div
      className="flex w-28 shrink-0 flex-col items-end text-right"
      title={content.title}
      aria-label={t('projectsOverview.usageColumn')}
    >
      <span className="font-mono text-xs tabular-nums text-foreground-muted">{content.value}</span>
      {content.detail && (
        <span className="text-[11px] text-foreground-passive">{content.detail}</span>
      )}
    </div>
  );
}

function SectionTitle({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <span className="text-xs text-foreground-muted">{count}</span>
    </div>
  );
}

function EmptyRow({ label }: { label: string }) {
  return <p className="px-1 text-sm text-foreground-muted">{label}</p>;
}

export function ProjectsOverviewTitlebar() {
  return <Titlebar />;
}

export function ProjectsOverviewMainPanel() {
  return <ProjectsOverview />;
}

export const projectsOverviewView = {
  TitlebarSlot: ProjectsOverviewTitlebar,
  MainPanel: ProjectsOverviewMainPanel,
};
