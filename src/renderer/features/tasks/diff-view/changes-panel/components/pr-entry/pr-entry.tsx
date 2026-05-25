import type { TFunction } from 'i18next';
import { ExternalLink } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPrNumber, type PullRequest } from '@shared/pull-requests';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { PrMergeLine } from '@renderer/lib/components/pr-merge-line';
import { PrNumberBadge } from '@renderer/lib/components/pr-number-badge';
import { StatusIcon } from '@renderer/lib/components/pr-status-icon';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { type SplitButtonAction } from '@renderer/lib/ui/split-button';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { cn } from '@renderer/utils/utils';
import { PrChecksList } from './checks-list';
import { PrCommitsList } from './commits-list';
import { PrFilesList } from './files-list';
import { MergeFooter } from './merge-footer';

export type MergeMode = 'merge' | 'squash' | 'rebase';

export type MergeSeverity = 'success' | 'warning' | 'error' | 'neutral';

export type MergeUiState = {
  kind: 'ready' | 'draft' | 'conflicts' | 'behind' | 'blocked' | 'unstable' | 'unknown';
  severity: MergeSeverity;
  title: string;
  detail?: string;
  canMerge: boolean;
};

const mergeLabelKeys: Record<MergeMode, string> = {
  merge: 'pullRequests.mergeMode.merge.label',
  squash: 'pullRequests.mergeMode.squash.label',
  rebase: 'pullRequests.mergeMode.rebase.label',
};

const mergeDescriptionKeys: Record<MergeMode, string> = {
  merge: 'pullRequests.mergeMode.merge.description',
  squash: 'pullRequests.mergeMode.squash.description',
  rebase: 'pullRequests.mergeMode.rebase.description',
};

function computeMergeUiState(pr: PullRequest, t: TFunction): MergeUiState {
  if (pr.status !== 'open') {
    return {
      kind: 'unknown',
      severity: 'neutral',
      title: t('pullRequests.mergeState.unknown.title'),
      detail: t('pullRequests.mergeState.unknown.detailWithStatus'),
      canMerge: false,
    };
  }
  if (pr.isDraft) {
    return {
      kind: 'draft',
      severity: 'neutral',
      title: t('pullRequests.mergeState.draft.title'),
      detail: t('pullRequests.mergeState.draft.detail'),
      canMerge: false,
    };
  }
  switch (pr.mergeStateStatus) {
    case 'CLEAN':
      return {
        kind: 'ready',
        severity: 'success',
        title: t('pullRequests.mergeState.ready.title'),
        detail: t('pullRequests.mergeState.ready.detail'),
        canMerge: true,
      };
    case 'DIRTY':
      return {
        kind: 'conflicts',
        severity: 'error',
        title: t('pullRequests.mergeState.conflicts.title'),
        detail: t('pullRequests.mergeState.conflicts.detail'),
        canMerge: false,
      };
    case 'BEHIND':
      return {
        kind: 'behind',
        severity: 'warning',
        title: t('pullRequests.mergeState.behind.title'),
        detail: t('pullRequests.mergeState.behind.detail'),
        canMerge: false,
      };
    case 'BLOCKED':
      return {
        kind: 'blocked',
        severity: 'error',
        title: t('pullRequests.mergeState.blocked.title'),
        detail: t('pullRequests.mergeState.blocked.detail'),
        canMerge: false,
      };
    case 'HAS_HOOKS':
      return {
        kind: 'blocked',
        severity: 'error',
        title: t('pullRequests.mergeState.blocked.title'),
        detail: t('pullRequests.mergeState.checksBlocked.detail'),
        canMerge: false,
      };
    case 'UNSTABLE':
      return {
        kind: 'unstable',
        severity: 'warning',
        title: t('pullRequests.mergeState.unstable.title'),
        detail: t('pullRequests.mergeState.unstable.detail'),
        canMerge: false,
      };
    default:
      return {
        kind: 'unknown',
        severity: 'neutral',
        title: t('pullRequests.mergeState.unknown.title'),
        detail: t('pullRequests.mergeState.unknown.detail'),
        canMerge: false,
      };
  }
}

export const PullRequestEntry = observer(function PullRequestEntry({ pr }: { pr: PullRequest }) {
  const { t } = useTranslation();
  const task = useProvisionedTask();
  const prStatus = pr.status;
  const prStore = task.workspace.pr;
  const diffView = task.taskView.diffView;
  const showConfirm = useShowModal('confirmActionModal');
  const [isMerging, setIsMerging] = useState(false);
  const tab = diffView.effectivePrTab;
  const isOpen = pr.status === 'open';

  const uiState = computeMergeUiState(pr, t);

  const doMerge = async (strategy: MergeMode) => {
    setIsMerging(true);
    try {
      await prStore.mergePr(pr.url, { strategy, commitHeadOid: pr.headRefOid });
    } finally {
      setIsMerging(false);
    }
  };

  const handleMergeClick = (strategy: MergeMode) => {
    if (uiState.canMerge) {
      void doMerge(strategy);
    } else {
      showConfirm({
        title: t('pullRequests.mergeAnywayTitle'),
        description: t('pullRequests.mergeAnywayDescription', {
          reason: uiState.detail ?? uiState.title,
        }),
        confirmLabel: t('pullRequests.mergeAnywayConfirm'),
        variant: 'destructive',
        onSuccess: () => void doMerge(strategy),
      });
    }
  };

  const mergeActions: SplitButtonAction[] = (['merge', 'squash', 'rebase'] as const).map(
    (strategy) => ({
      value: strategy,
      label: t(mergeLabelKeys[strategy]),
      description: t(mergeDescriptionKeys[strategy]),
      action: () => handleMergeClick(strategy),
    })
  );

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col border-t border-border')}>
      <div className="flex flex-col gap-2 p-2.5 w-full">
        <div className="flex items-center gap-2 justify-between">
          <button
            className="relative flex gap-2 items-center min-w-0 group"
            onClick={() => rpc.app.openExternal(pr.url)}
          >
            <StatusIcon className="size-4" status={prStatus} />
            <span className="flex-1 min-w-0 truncate text-sm font-normal">{pr.title}</span>
            <PrNumberBadge number={getPrNumber(pr) ?? 0} />
            <span className="absolute right-0 flex items-center pl-4 pr-0.5 bg-linear-to-r from-transparent to-background opacity-0 group-hover:opacity-100 transition-opacity">
              <ExternalLink className="size-3.5 text-foreground-muted" />
            </span>
          </button>
        </div>
        <PrMergeLine pr={pr} />
      </div>
      <div className="min-h-0 flex flex-1 flex-col px-2.5">
        <ToggleGroup
          value={[tab]}
          size={'xs'}
          className="w-full"
          onValueChange={([value]) => {
            if (value) {
              diffView.setPrTab(value as 'files' | 'commits' | 'checks');
            }
          }}
        >
          <ToggleGroupItem className="flex-1" value="files" disabled={!isOpen}>
            {t('pullRequests.tabs.files')}
          </ToggleGroupItem>
          <ToggleGroupItem className="flex-1" value="commits">
            {t('pullRequests.tabs.commits')}
          </ToggleGroupItem>
          <ToggleGroupItem className="flex-1" value="checks">
            {t('pullRequests.tabs.checks')}
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === 'files' && <PrFilesList pr={pr} />}
          {tab === 'commits' && <PrCommitsList />}
          {tab === 'checks' && <PrChecksList pr={pr} />}
        </div>
      </div>
      {pr.status === 'open' && (
        <MergeFooter
          uiState={uiState}
          mergeActions={mergeActions}
          isMerging={isMerging}
          onMarkReady={() => {
            prStore.markReadyForReview(pr.url).catch(() => {});
          }}
        />
      )}
    </div>
  );
});
