import { RefreshCw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Branch } from '@shared/git';
import { getRepositoryStore } from '@renderer/features/projects/stores/project-selectors';
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '@renderer/lib/ui/dropdown-menu';
import { BranchSelector } from './branch-selector';

function getProjectBranches(projectId: string) {
  const repository = getRepositoryStore(projectId);
  const configuredRemoteName = repository?.configuredRemote.name ?? 'origin';
  const branches: Branch[] = repository
    ? repository.branches.filter(
        (branch) =>
          branch.type === 'local' ||
          (branch.type === 'remote' && branch.remote.name === configuredRemoteName)
      )
    : [];

  return { repository, branches };
}

function branchMenuValue(branch: Branch): string {
  return branch.type === 'remote'
    ? `remote:${branch.remote.name}/${branch.branch}`
    : `local:${branch.branch}`;
}

function branchMenuLabel(branch: Branch): string {
  return branch.type === 'remote' ? `${branch.remote.name}/${branch.branch}` : branch.branch;
}

export interface ProjectBranchSelectorProps {
  projectId: string;
  value?: Branch;
  onValueChange: (value: Branch) => void;
  remoteOnly?: boolean;
  localOnly?: boolean;
  trigger?: React.ReactNode;
}

export const ProjectBranchSelector = observer(function ProjectBranchSelector({
  projectId,
  value,
  onValueChange,
  remoteOnly,
  localOnly,
  trigger,
}: ProjectBranchSelectorProps) {
  const { repository, branches } = getProjectBranches(projectId);

  return (
    <BranchSelector
      branches={branches}
      value={value}
      onValueChange={onValueChange}
      remoteOnly={remoteOnly}
      localOnly={localOnly}
      trigger={trigger}
      onRefresh={() => repository?.refresh()}
      isRefreshing={repository?.loading ?? false}
    />
  );
});

export interface ProjectBranchMenuItemsProps {
  projectId: string;
  value?: Branch;
  onValueChange: (value: Branch) => void;
  remoteOnly?: boolean;
  localOnly?: boolean;
}

/**
 * Branch choices for use inside a DropdownMenu submenu. This shares the same
 * configured-remote filtering as ProjectBranchSelector while keeping every
 * interaction in menu primitives rather than nesting a combobox in a menu.
 */
export const ProjectBranchMenuItems = observer(function ProjectBranchMenuItems({
  projectId,
  value,
  onValueChange,
  remoteOnly = false,
  localOnly = false,
}: ProjectBranchMenuItemsProps) {
  const { t } = useTranslation();
  const { repository, branches } = getProjectBranches(projectId);
  const visibleBranches = branches.filter((branch) => {
    if (remoteOnly) return branch.type === 'remote';
    if (localOnly) return branch.type === 'local';
    return true;
  });
  const localBranches = visibleBranches.filter((branch) => branch.type === 'local');
  const remoteBranches = visibleBranches.filter((branch) => branch.type === 'remote');

  return (
    <>
      {visibleBranches.length > 0 ? (
        <DropdownMenuRadioGroup
          value={value ? branchMenuValue(value) : undefined}
          onValueChange={(nextValue) => {
            const nextBranch = visibleBranches.find(
              (branch) => branchMenuValue(branch) === nextValue
            );
            if (nextBranch) onValueChange(nextBranch);
          }}
        >
          {localBranches.length > 0 ? (
            <>
              <DropdownMenuLabel>{t('home.localMode')}</DropdownMenuLabel>
              {localBranches.map((branch) => (
                <DropdownMenuRadioItem
                  key={branchMenuValue(branch)}
                  value={branchMenuValue(branch)}
                  disabled={branch.branch.startsWith('_reserve')}
                  closeOnClick
                  className="gap-2 rounded-md px-2.5 py-2"
                >
                  <span className="min-w-0 truncate">{branchMenuLabel(branch)}</span>
                </DropdownMenuRadioItem>
              ))}
            </>
          ) : null}
          {localBranches.length > 0 && remoteBranches.length > 0 ? <DropdownMenuSeparator /> : null}
          {remoteBranches.length > 0 ? (
            <>
              <DropdownMenuLabel>{t('home.remoteMode')}</DropdownMenuLabel>
              {remoteBranches.map((branch) => (
                <DropdownMenuRadioItem
                  key={branchMenuValue(branch)}
                  value={branchMenuValue(branch)}
                  disabled={branch.branch.startsWith('_reserve')}
                  closeOnClick
                  className="gap-2 rounded-md px-2.5 py-2"
                >
                  <span className="min-w-0 truncate">{branchMenuLabel(branch)}</span>
                </DropdownMenuRadioItem>
              ))}
            </>
          ) : null}
        </DropdownMenuRadioGroup>
      ) : (
        <DropdownMenuItem disabled className="rounded-md px-2.5 py-2 text-foreground-muted">
          {t('branchSelector.noBranches')}
        </DropdownMenuItem>
      )}
      {repository ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            closeOnClick={false}
            disabled={repository.loading}
            onClick={() => repository.refresh()}
            className="gap-2 rounded-md px-2.5 py-2"
          >
            <RefreshCw className={repository.loading ? 'animate-spin' : undefined} />
            {t('branchSelector.refreshBranches')}
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  );
});
