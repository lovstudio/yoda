import { AppWindow, Check, ExternalLink, FilePlus2, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import {
  featureArtifactStatusIds,
  featureRequiredArtifacts,
  type Feature,
  type FeatureArtifact,
  type FeatureArtifactType,
} from '@shared/features';
import type { useFeatureMutations } from '@renderer/features/features/use-features';
import { openProjectFileTab } from '@renderer/features/project-file/project-file-session';
import { joinProjectPath } from '@renderer/features/projects/project-path';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { openTaskWhenReady } from '@renderer/features/tasks/open-task-when-ready';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import {
  FilePathActionsDropdown,
  type FilePathTarget,
} from '@renderer/lib/components/file-path-actions';
import { FileIcon } from '@renderer/lib/editor/file-icon';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { cn } from '@renderer/utils/utils';

function isWebUri(uri: string): boolean {
  return /^https?:\/\//i.test(uri);
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
}

function ArtifactLocation({
  projectId,
  artifact,
}: {
  projectId: string;
  artifact: FeatureArtifact;
}) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const project = asMounted(getProjectStore(projectId));
  const sourceTaskId = artifact.sourceTaskId;
  const sourceTask = sourceTaskId
    ? asProvisioned(getTaskStore(projectId, sourceTaskId))
    : undefined;
  const webUri = isWebUri(artifact.uri);
  if (webUri) {
    return (
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t('featureDelivery.artifacts.open')}
        onClick={() => void rpc.app.openExternal(artifact.uri)}
      >
        <ExternalLink className="size-3.5" />
      </Button>
    );
  }

  if (sourceTaskId && !sourceTask) {
    return (
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t('featureDelivery.artifacts.openSourceTask')}
        onClick={() =>
          void openTaskWhenReady(projectId, sourceTaskId, navigate, {
            kind: 'file',
            path: artifact.uri,
          })
        }
      >
        <AppWindow className="size-3.5" />
      </Button>
    );
  }

  if (!project && !sourceTask) return null;
  const relativePath = isAbsolutePath(artifact.uri) ? null : artifact.uri;
  const workspacePath = sourceTask?.path ?? project?.data.path;
  if (!workspacePath) return null;
  const target: FilePathTarget = {
    absolutePath: relativePath ? joinProjectPath(workspacePath, relativePath) : artifact.uri,
    relativePath,
    kind: 'file',
    sshConnectionId:
      sourceTask?.workspace.sshConnectionId ??
      (project?.data.type === 'ssh' ? project.data.connectionId : null),
  };

  return (
    <FilePathActionsDropdown target={target}>
      <DropdownMenuItem
        onClick={(event) => {
          event.stopPropagation();
          if (sourceTask && sourceTaskId) {
            void openTaskWhenReady(projectId, sourceTaskId, navigate, {
              kind: 'file',
              path: artifact.uri,
            });
            return;
          }
          openProjectFileTab(projectId, artifact.uri);
        }}
      >
        <AppWindow className="size-4" />
        {t('fileActions.openInMainArea')}
      </DropdownMenuItem>
    </FilePathActionsDropdown>
  );
}

export const FeatureArtifacts = observer(function FeatureArtifacts({
  projectId,
  feature,
  mutations,
}: {
  projectId: string;
  feature: Feature;
  mutations: ReturnType<typeof useFeatureMutations>;
}) {
  const { t } = useTranslation();
  const showArtifact = useShowModal('featureArtifactModal');
  const showConfirm = useShowModal('confirmActionModal');
  const suggestedType: FeatureArtifactType =
    featureRequiredArtifacts[feature.stage]?.find(
      (type) => !feature.artifacts.some((artifact) => artifact.type === type)
    ) ?? 'product_spec';

  const addArtifact = () => showArtifact({ projectId, featureId: feature.id, suggestedType });

  const removeArtifact = (artifact: FeatureArtifact) => {
    showConfirm({
      title: t('featureDelivery.artifacts.removeTitle'),
      description: t('featureDelivery.artifacts.removeDescription', { title: artifact.title }),
      confirmLabel: t('featureDelivery.artifacts.remove'),
      variant: 'destructive',
      onSuccess: () => mutations.removeArtifact.mutate(artifact.id),
    });
  };

  return (
    <section className="border-t border-border pt-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-2 text-xs font-medium text-foreground">
          <FilePlus2 className="size-3.5" />
          {t('featureDelivery.artifacts.title')}
          <span className="font-mono text-[10px] text-foreground-passive">
            {feature.artifacts.length}
          </span>
        </h3>
        <Button variant="outline" size="xs" onClick={addArtifact}>
          <FilePlus2 className="size-3" />
          {t('featureDelivery.artifacts.add')}
        </Button>
      </div>
      {feature.artifacts.length === 0 ? (
        <button
          type="button"
          className="w-full rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-foreground-passive transition-colors hover:border-border-1 hover:bg-background-1"
          onClick={addArtifact}
        >
          {t('featureDelivery.artifacts.empty')}
        </button>
      ) : (
        <div className="divide-y divide-border rounded-md border border-border">
          {feature.artifacts.map((artifact) => (
            <div key={artifact.id} className="group flex min-w-0 items-center gap-2 px-2.5 py-2">
              <FileIcon filename={artifact.uri} className="shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate text-xs text-foreground">{artifact.title}</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Badge
                          variant={artifact.status === 'stale' ? 'destructive' : 'secondary'}
                          className={cn(
                            'cursor-pointer',
                            artifact.status === 'approved' && 'bg-status-done/10 text-status-done'
                          )}
                          render={<button type="button" />}
                        >
                          {t(`featureDelivery.artifactStatuses.${artifact.status}`)}
                        </Badge>
                      }
                    />
                    <DropdownMenuContent align="start" className="w-40">
                      {featureArtifactStatusIds.map((status) => (
                        <DropdownMenuItem
                          key={status}
                          disabled={status === artifact.status}
                          onClick={() =>
                            mutations.updateArtifact.mutate({
                              artifactId: artifact.id,
                              input: { status },
                            })
                          }
                        >
                          <Check
                            className={cn(
                              'size-3.5 opacity-0',
                              status === artifact.status && 'opacity-100'
                            )}
                          />
                          {t(`featureDelivery.artifactStatuses.${status}`)}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <p className="mt-0.5 truncate font-mono text-[10px] text-foreground-passive">
                  {t(`featureDelivery.artifactTypes.${artifact.type}`)} · {artifact.uri}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
                <ArtifactLocation projectId={projectId} artifact={artifact} />
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('featureDelivery.artifacts.remove')}
                  onClick={() => removeArtifact(artifact)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
});
