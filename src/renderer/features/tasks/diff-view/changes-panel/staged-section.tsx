import { Minus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { commitRef, HEAD_REF, type GitChange } from '@shared/git';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { ActionCard } from './components/action-card';
import { CommitCard } from './components/commit-card';
import { SectionHeader } from './components/section-header';
import { VirtualizedChangesList } from './components/virtualized-changes-list';
import { usePrefetchDiffModels } from './hooks/use-prefetch-diff-models';

export const StagedSection = observer(function StagedSection() {
  const { t } = useTranslation();
  const { projectId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const git = provisioned.workspace.git;
  const changesView = provisioned.taskView.diffView.changesView;

  const changes = git.stagedFileChanges;
  const hasChanges = changes.length > 0;
  const selectedPaths = changesView.stagedSelection;
  const selectionState = changesView.stagedSelectionState;

  const activePath =
    provisioned.taskView.tabManager.activeDescriptor?.kind === 'diff' &&
    provisioned.taskView.tabManager.activeDescriptor.diffGroup === 'staged'
      ? provisioned.taskView.tabManager.activeDescriptor.path
      : undefined;

  const prefetch = usePrefetchDiffModels(projectId, provisioned.workspaceId, 'staged', HEAD_REF);

  const handleSelectChange = (change: GitChange) => {
    provisioned.taskView.tabManager.openDiffPreview(
      { path: change.path, type: 'git', group: 'staged', originalRef: commitRef('HEAD') },
      change.status
    );
  };

  const handleDoubleClickChange = (change: GitChange) => {
    provisioned.taskView.tabManager.openDiff(
      { path: change.path, type: 'git', group: 'staged', originalRef: commitRef('HEAD') },
      change.status
    );
  };

  const handleUnstageSelection = () => {
    const paths = [...selectedPaths];
    void git.unstageFiles(paths);
    changesView.clearStagedSelection();
  };

  const handleUnstageAll = () => {
    void git.unstageAllFiles();
  };

  return (
    <>
      <SectionHeader
        label={t('changes.staged')}
        count={changes.length}
        selectionState={selectionState}
        onToggleAll={() => changesView.toggleAllStaged()}
        actions={undefined}
        collapsed={!changesView.expandedSections.staged}
        onToggleCollapsed={() => changesView.toggleExpanded('staged')}
      />
      {!hasChanges && (
        <EmptyState
          label={t('changes.nothingStaged')}
          description={t('changes.nothingStagedDescription')}
        />
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {hasChanges && selectedPaths.size > 0 && (
          <ActionCard
            selectedCount={selectedPaths.size}
            selectionActions={
              <Button
                variant="outline"
                size="xs"
                onClick={handleUnstageSelection}
                title={t('changes.unstageSelectedFiles')}
              >
                <Minus className="size-3" />
                {t('changes.unstage')}
              </Button>
            }
            generalActions={
              <Button
                variant="ghost"
                size="xs"
                disabled={!hasChanges}
                onClick={handleUnstageAll}
                title={t('changes.unstageAllFiles')}
              >
                <Minus className="size-3" />
                {t('changes.unstageAll')}
              </Button>
            }
          />
        )}
        <div className="min-h-0 flex-1 px-1">
          <VirtualizedChangesList
            changes={changes}
            isSelected={(path) => selectedPaths.has(path)}
            onToggleSelect={(path) => changesView.toggleStagedItem(path)}
            activePath={activePath}
            onSelectChange={handleSelectChange}
            onDoubleClickChange={handleDoubleClickChange}
            onPrefetch={(change) => prefetch(change.path)}
          />
        </div>
        {hasChanges && <CommitCard />}
      </div>
    </>
  );
});
