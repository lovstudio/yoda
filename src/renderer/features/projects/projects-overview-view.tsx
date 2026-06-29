import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  FolderClosed,
  FolderInput,
  FolderTree,
  Trash2,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { projectDisplayName, type LocalProject, type SshProject } from '@shared/projects';
import type { ProjectStore } from '@renderer/features/projects/stores/project';
import {
  asMounted,
  getProjectManagerStore,
} from '@renderer/features/projects/stores/project-selectors';
import { isRegistered } from '@renderer/features/tasks/stores/task';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';

const ARCHIVED_QUERY_KEY = ['archivedProjects'];

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

  const { data: archived = [], isLoading } = useQuery({
    queryKey: ARCHIVED_QUERY_KEY,
    queryFn: () => rpc.projects.getArchivedProjects(),
  });

  const active = Array.from(getProjectManagerStore().projects.values()).filter(
    (store) => store.state !== 'unregistered' && !store.data?.isInternal
  );

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
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-8 py-8">
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
            <div className="flex flex-col gap-1 rounded-xl border border-border/60 bg-muted/10 p-2">
              {active.map((store) => {
                const data = store.data;
                const Icon = projectIcon(data?.type === 'ssh');
                const count = activeTaskCount(store);
                return (
                  <div
                    key={store.id}
                    className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-background-tertiary-1"
                  >
                    <Icon className="size-4 shrink-0 text-foreground-muted" />
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 flex-col text-left"
                      onClick={() => navigate('project', { projectId: store.id })}
                    >
                      <span className="truncate text-sm text-foreground">{store.displayName}</span>
                      <span className="truncate text-xs text-foreground-muted">{data?.path}</span>
                    </button>
                    {count > 0 && (
                      <Badge variant="secondary" className="shrink-0">
                        {t('projectsOverview.activeTasks', { count })}
                      </Badge>
                    )}
                    {data && (
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
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <SectionTitle label={t('projectsOverview.archived')} count={archived.length} />
          {isLoading ? (
            <EmptyRow label={t('settings.archivedProjects.loading')} />
          ) : archived.length === 0 ? (
            <EmptyRow label={t('settings.archivedProjects.empty')} />
          ) : (
            <div className="flex flex-col gap-1 rounded-xl border border-border/60 bg-muted/10 p-2">
              {archived.map((project) => {
                const Icon = projectIcon(project.type === 'ssh');
                return (
                  <div key={project.id} className="flex items-center gap-3 rounded-md px-2 py-2">
                    <Icon className="size-4 shrink-0 text-foreground-muted" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm text-foreground">
                        {projectDisplayName(project)}
                      </span>
                      <span className="truncate text-xs text-foreground-muted">{project.path}</span>
                    </div>
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
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
});

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
