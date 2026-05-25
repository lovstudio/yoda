import { ArrowDown, ArrowUp, GitBranch, RefreshCcw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import {
  getProjectStore,
  getRepositoryStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import {
  asProvisioned,
  getTaskGitStore,
  getTaskStore,
} from '@renderer/features/tasks/stores/task-selectors';
import { useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { useGitActions } from '@renderer/features/tasks/use-git-actions';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';

export const GitStatusSection = observer(function GitStatusSection() {
  const { t } = useTranslation();
  const { projectId, taskId } = useTaskViewContext();
  const workspaceId = asProvisioned(getTaskStore(projectId, taskId))?.workspaceId;
  const branchName = getTaskGitStore(projectId, taskId)?.branchName;
  const projectName = projectDisplayName(getProjectStore(projectId)) ?? t('common.repository');
  const repositoryStore = getRepositoryStore(projectId);
  const showAddRemoteModal = useShowModal('addRemoteModal');

  const {
    hasUpstream,
    aheadCount,
    behindCount,
    fetch,
    pull,
    push,
    publish,
    isPublishing,
    isFetching,
    isPulling,
    isPushing,
  } = useGitActions(projectId, taskId);
  const shouldOfferAddRemote = (repositoryStore?.remotes.length ?? 0) === 0;
  const publishTooltip = isPublishing
    ? t('tasks.git.publishing')
    : !branchName
      ? t('changes.initialCommitFirst')
      : shouldOfferAddRemote
        ? t('changes.createOrLinkRemoteThenPublish')
        : t('tasks.git.publishBranch');

  const handlePublishClick = () => {
    if (!branchName || !workspaceId) return;
    if (shouldOfferAddRemote) {
      showAddRemoteModal({
        projectId,
        projectName,
        branchName,
        workspaceId,
      });
      return;
    }
    publish();
  };

  return (
    <TooltipProvider>
      <div className="p-2 border-t border-border flex flex-col gap-2">
        <div className="flex items-center gap-2 text-foreground-muted justify-between">
          <Tooltip>
            <TooltipTrigger className="flex min-w-0 items-center gap-2">
              <GitBranch className="size-3 shrink-0" />
              <span className="truncate text-xs">{branchName}</span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {branchName ? branchName : t('changes.initialCommitFirst')}
            </TooltipContent>
          </Tooltip>
          <div className="flex items-center gap-1">
            {hasUpstream ? (
              <>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="outline"
                        size="icon-xs"
                        disabled={isFetching}
                        onClick={() => fetch()}
                      >
                        <RefreshCcw className="size-3" />
                      </Button>
                    }
                  />
                  <TooltipContent>
                    {isFetching ? t('tasks.git.fetching') : t('tasks.git.fetchChanges')}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="outline"
                        size="icon-xs"
                        disabled={isPulling || behindCount === 0}
                        onClick={() => pull()}
                      >
                        <ArrowDown className="size-3" />
                      </Button>
                    }
                  />
                  <TooltipContent>
                    {isPulling
                      ? t('tasks.git.pulling')
                      : behindCount === 0
                        ? t('tasks.git.nothingToPull')
                        : t('tasks.git.pullChanges')}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="outline"
                        size="icon-xs"
                        disabled={isPushing || aheadCount === 0}
                        onClick={() => push()}
                      >
                        <ArrowUp className="size-3" />
                      </Button>
                    }
                  />
                  <TooltipContent>
                    {isPushing
                      ? t('tasks.git.pushing')
                      : aheadCount === 0
                        ? t('tasks.git.nothingToPush')
                        : t('tasks.git.pushChanges')}
                  </TooltipContent>
                </Tooltip>
              </>
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={isPublishing || !branchName}
                      onClick={handlePublishClick}
                    >
                      <ArrowUp className="size-3" />
                      {isPublishing
                        ? t('tasks.git.publishing')
                        : shouldOfferAddRemote
                          ? t('tasks.addRemote.title')
                          : t('tasks.git.publish')}
                    </Button>
                  }
                />
                <TooltipContent>{publishTooltip}</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
});
