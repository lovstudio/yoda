import { FolderOpen, Github, Plus, Server, type LucideIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import yodaLogoWhite from '@/assets/images/yoda/yoda_logo_white.svg';
import yodaLogo from '@/assets/images/yoda/yoda_logo.svg';
import { getSortInstant } from '@renderer/features/sidebar/sidebar-store';
import { registeredTaskData, type TaskStore } from '@renderer/features/tasks/stores/task';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';

const PROJECT_ACTIONS = [
  {
    label: 'Open project',
    icon: FolderOpen,
    modalArgs: { strategy: 'local', mode: 'pick' },
  },
  {
    label: 'Create New Project',
    icon: Plus,
    modalArgs: { strategy: 'local', mode: 'new' },
  },
  {
    label: 'Clone from GitHub',
    icon: Github,
    modalArgs: { strategy: 'local', mode: 'clone' },
  },
  {
    label: 'Add Remote Project',
    icon: Server,
    modalArgs: { strategy: 'ssh', mode: 'pick' },
  },
] as const;

export function HomeTitlebar() {
  return <Titlebar />;
}

export const HomeMainPanel = observer(function HomeMainPanel() {
  const { effectiveTheme } = useTheme();
  const showAddProjectModal = useShowModal('addProjectModal');
  const { navigate } = useNavigate();
  const recent = getRecentTasks(5);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background text-foreground">
      <div className="container mx-auto flex min-h-full max-w-6xl flex-1 flex-col justify-center px-8 py-8">
        <div className="mb-3 text-center">
          <div className="mb-3 flex items-center justify-center">
            <div className="logo-shimmer-container">
              <img
                key={effectiveTheme}
                src={effectiveTheme === 'emdark' ? yodaLogoWhite : yodaLogo}
                alt="Yoda"
                className="logo-shimmer-image"
              />
              <span
                className="logo-shimmer-overlay"
                aria-hidden="true"
                style={{
                  WebkitMaskImage: `url(${effectiveTheme === 'emdark' ? yodaLogoWhite : yodaLogo})`,
                  maskImage: `url(${effectiveTheme === 'emdark' ? yodaLogoWhite : yodaLogo})`,
                  WebkitMaskRepeat: 'no-repeat',
                  maskRepeat: 'no-repeat',
                  WebkitMaskSize: 'contain',
                  maskSize: 'contain',
                  WebkitMaskPosition: 'center',
                  maskPosition: 'center',
                }}
              />
            </div>
          </div>
          {recent.length > 0 ? (
            <ul className="mx-auto flex max-w-[600px] flex-col items-center gap-1">
              {recent.map(({ projectId, taskId, label }) => (
                <li key={`${projectId}:${taskId}`}>
                  <button
                    type="button"
                    onClick={() => navigate('task', { projectId, taskId })}
                    className="rounded px-2 py-0.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {label}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="whitespace-nowrap text-xs text-muted-foreground">
              Agentic Development Environment
            </p>
          )}
        </div>
        <div className="mx-auto mt-4 grid w-full max-w-[600px] grid-cols-2 gap-2 sm:grid-cols-[repeat(4,minmax(132px,1fr))]">
          {PROJECT_ACTIONS.map((action) => (
            <HomeProjectAction
              key={action.label}
              label={action.label}
              icon={action.icon}
              onClick={() => showAddProjectModal(action.modalArgs)}
            />
          ))}
        </div>
      </div>
    </div>
  );
});

type RecentTaskRow = {
  projectId: string;
  taskId: string;
  label: string;
};

function getRecentTasks(limit: number): RecentTaskRow[] {
  const entries: { projectId: string; projectName: string; task: TaskStore; sortKey: string }[] =
    [];
  for (const project of appState.projects.projects.values()) {
    if (!project.mountedProject) continue;
    const projectId = project.id;
    if (!projectId) continue;
    const projectName = project.name?.trim() || projectId;
    for (const task of project.mountedProject.taskManager.tasks.values()) {
      const visible =
        task.state === 'unregistered' || !('archivedAt' in task.data && task.data.archivedAt);
      if (!visible) continue;
      const sortKey = getSortInstant(task, 'updated');
      if (!sortKey) continue;
      entries.push({ projectId, projectName, task, sortKey });
    }
  }
  entries.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  return entries.slice(0, limit).map(({ projectId, projectName, task }) => {
    const reg = registeredTaskData(task);
    const branch = reg?.branchName?.trim();
    const suffix = branch && branch.length > 0 ? branch : task.displayName;
    return { projectId, taskId: task.data.id, label: `${projectName}/${suffix}` };
  });
}

function HomeProjectAction({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="group flex h-[68px] w-full flex-col items-start rounded-md border border-border/80 bg-background px-3.5 py-3 text-left shadow-sm transition-all hover:border-border-1 hover:bg-background-1 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Icon className="size-4 text-foreground-muted transition-colors group-hover:text-foreground" />
      <span className="mt-auto whitespace-nowrap pt-4 text-[11px] font-semibold leading-none tracking-normal text-foreground">
        {label}
      </span>
    </button>
  );
}

export const homeView = {
  TitlebarSlot: HomeTitlebar,
  MainPanel: HomeMainPanel,
};
