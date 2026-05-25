import { Plus, Undo2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { commitRef, HEAD_REF, type GitChange } from '@shared/git';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { ActionCard } from './components/action-card';
import { CommitCard } from './components/commit-card';
import { SectionHeader } from './components/section-header';
import { VirtualizedChangesList } from './components/virtualized-changes-list';
import { usePrefetchDiffModels } from './hooks/use-prefetch-diff-models';

export const UnstagedSection = observer(function UnstagedSection() {
  const { t } = useTranslation();
  const { projectId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const git = provisioned.workspace.git;
  const changesView = provisioned.taskView.diffView.changesView;

  const changes = git.unstagedFileChanges;
  const hasChanges = changes.length > 0;
  const hasStagedChanges = git.stagedFileChanges.length > 0;
  const selectedPaths = changesView.unstagedSelection;
  const selectionState = changesView.unstagedSelectionState;

  const activePath =
    provisioned.taskView.tabManager.activeDescriptor?.kind === 'diff' &&
    provisioned.taskView.tabManager.activeDescriptor.diffGroup === 'disk'
      ? provisioned.taskView.tabManager.activeDescriptor.path
      : undefined;

  const prefetch = usePrefetchDiffModels(projectId, provisioned.workspaceId, 'disk', HEAD_REF);

  const showConfirmActionModal = useShowModal('confirmActionModal');

  const handleSelectChange = (change: GitChange) => {
    provisioned.taskView.tabManager.openDiffPreview(
      { path: change.path, type: 'disk', group: 'disk', originalRef: commitRef('HEAD') },
      change.status
    );
  };

  const handleDoubleClickChange = (change: GitChange) => {
    provisioned.taskView.tabManager.openDiff(
      { path: change.path, type: 'disk', group: 'disk', originalRef: commitRef('HEAD') },
      change.status
    );
  };

  const handleDiscardSelection = () => {
    const paths = [...selectedPaths];
    showConfirmActionModal({
      title: t('changes.discardSelectedTitle'),
      variant: 'destructive',
      description: t('changes.discardSelectedDescription'),
      onSuccess: () => {
        void (async () => {
          await git.discardFiles(paths);
          changesView.clearUnstagedSelection();
        })();
      },
    });
  };

  const handleDiscardAll = () => {
    showConfirmActionModal({
      title: t('changes.discardAllTitle'),
      variant: 'destructive',
      description: t('changes.discardAllDescription'),
      onSuccess: () => void git.discardAllFiles(),
    });
  };

  const handleStageSelection = () => {
    const paths = [...selectedPaths];
    void git.stageFiles(paths);
    changesView.clearUnstagedSelection();
  };

  const handleStageAll = () => {
    void git.stageAllFiles();
  };

  return (
    <>
      <SectionHeader
        label={t('changes.changed')}
        collapsed={!changesView.expandedSections.unstaged}
        onToggleCollapsed={() => changesView.toggleExpanded('unstaged')}
        count={changes.length}
        selectionState={selectionState}
        onToggleAll={() => changesView.toggleAllUnstaged()}
        actions={undefined}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {!hasChanges && (
          <EmptyState
            label={t('changes.workingTreeClean')}
            description={t('changes.noUncommittedChanges')}
          />
        )}
        {hasChanges && (
          <ActionCard
            selectedCount={selectedPaths.size}
            selectionActions={
              <>
                <Button
                  variant="link"
                  size="xs"
                  onClick={handleDiscardSelection}
                  title={t('changes.discardSelectedFiles')}
                  className="text-foreground-destructive"
                >
                  <Undo2 className="size-3" />
                  {t('changes.discard')}
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={handleStageSelection}
                  title={t('changes.stageSelectedFiles')}
                >
                  <Plus className="size-3" />
                  {t('changes.stage')}
                </Button>
              </>
            }
            generalActions={
              <>
                <Button
                  variant="link"
                  size="xs"
                  disabled={!hasChanges}
                  onClick={handleDiscardAll}
                  title={t('changes.discardAllChanges')}
                  className="text-foreground-destructive"
                >
                  <Undo2 className="size-3" />
                  {t('changes.discardAll')}
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={!hasChanges}
                  onClick={handleStageAll}
                  title={t('changes.stageAllChanges')}
                >
                  <Plus className="size-3" />
                  {t('changes.stageAll')}
                </Button>
              </>
            }
          />
        )}
        <div className="min-h-0 flex-1 px-1">
          <VirtualizedChangesList
            changes={changes}
            isSelected={(path) => selectedPaths.has(path)}
            onToggleSelect={(path) => changesView.toggleUnstagedItem(path)}
            activePath={activePath}
            onSelectChange={handleSelectChange}
            onDoubleClickChange={handleDoubleClickChange}
            onPrefetch={(change) => prefetch(change.path)}
          />
        </div>
        {hasChanges && !hasStagedChanges && <CommitCard autoStage />}
      </div>
    </>
  );
});
