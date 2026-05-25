import { Loader2, TriangleAlert, Unplug } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { isUnregisteredProject } from '../../stores/project';
import {
  getProjectManagerStore,
  getProjectStore,
  projectViewKind,
  unmountedMountErrorMessage,
} from '../../stores/project-selectors';
import { ActiveProject } from './active-project';
import { PendingProjectStatus } from './pending-project';

export const ProjectMainPanel = observer(function ProjectMainPanel() {
  const {
    params: { projectId },
  } = useParams('project');
  const store = getProjectStore(projectId);
  const kind = projectViewKind(store);

  if (kind === 'creating' && store && isUnregisteredProject(store)) {
    return <PendingProjectStatus project={store} />;
  }

  if (kind === 'bootstrapping') {
    return <ProjectBootstrappingPanel />;
  }

  if (kind === 'path_not_found') {
    return <ProjectPathNotFoundPanel path={store?.error ?? ''} projectId={projectId} />;
  }

  if (kind === 'ssh_disconnected') {
    const connectionId = store?.error ?? '';
    return <ProjectSshDisconnectedPanel connectionId={connectionId} projectId={projectId} />;
  }

  if (kind === 'mount_error') {
    return <ProjectBootstrapErrorPanel message={unmountedMountErrorMessage(store)} />;
  }

  if (kind !== 'ready') {
    return <div className="flex flex-1 items-center justify-center text-foreground-muted" />;
  }

  return <ActiveProject />;
});

function ProjectBootstrappingPanel() {
  const { t } = useTranslation();

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3">
      <Loader2 className="h-5 w-5 animate-spin text-foreground-passive" />
      <p className="text-xs font-mono text-foreground-passive">{t('projects.settingUpProject')}</p>
    </div>
  );
}

function ProjectBootstrapErrorPanel({ message }: { message: string }) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-8">
      <div className="flex max-w-xs flex-col items-center text-center gap-2">
        <p className="text-sm font-medium font-mono text-foreground-destructive">
          {t('projects.failedSetUpProject')}
        </p>
        <p className="text-xs font-mono text-foreground-passive">{message}</p>
      </div>
    </div>
  );
}

function ProjectSshDisconnectedPanel({
  connectionId,
  projectId,
}: {
  connectionId: string;
  projectId: string;
}) {
  const { t } = useTranslation();
  const handleReconnect = () => {
    void appState.sshConnections
      .connect(connectionId)
      .then(() => getProjectManagerStore().mountProject(projectId))
      .catch(() => {});
  };

  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-8">
      <div className="flex max-w-sm flex-col items-center text-center gap-3">
        <Unplug className="h-6 w-6 text-foreground-passive" />
        <p className="text-sm font-medium font-mono text-foreground">
          {t('projects.sshNotConnected')}
        </p>
        <p className="text-xs text-foreground-passive">{t('projects.sshUnavailable')}</p>
        <button
          type="button"
          className="mt-2 text-xs text-foreground underline underline-offset-2 hover:text-foreground/80 transition-colors"
          onClick={handleReconnect}
        >
          {t('sidebar.reconnect')}
        </button>
      </div>
    </div>
  );
}

function ProjectPathNotFoundPanel({ path, projectId }: { path: string; projectId: string }) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-8">
      <div className="flex max-w-sm flex-col items-center text-center gap-3">
        <TriangleAlert className="h-6 w-6 text-foreground-destructive" />
        <p className="text-sm font-medium font-mono text-foreground-destructive">
          {t('projects.projectNotFound')}
        </p>
        {path && <p className="text-xs font-mono text-foreground-passive break-all">{path}</p>}
        <p className="text-xs text-foreground-passive">{t('projects.projectDirectoryMissing')}</p>
        <button
          type="button"
          className="mt-2 text-xs text-foreground-destructive underline underline-offset-2 hover:text-foreground-destructive/80 transition-colors"
          onClick={() => void getProjectManagerStore().deleteProject(projectId)}
        >
          {t('projects.removeProject')}
        </button>
      </div>
    </div>
  );
}
