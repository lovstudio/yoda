import { ChevronDown, GitBranch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BranchDisplay } from '@renderer/lib/components/branch-display';
import { ProjectBranchSelector } from '@renderer/lib/components/project-branch-selector';
import { ComboboxTrigger, ComboboxValue } from '@renderer/lib/ui/combobox';
import { Switch } from '@renderer/lib/ui/switch';
import { cn } from '@renderer/utils/utils';
import { type BranchSelectionState } from './use-branch-selection';

interface BranchPickerFieldProps {
  state: BranchSelectionState;
  projectId?: string;
  currentBranch?: string | null;
  label?: string;
  className?: string;
  isUnborn?: boolean;
}

export function BranchPickerField({
  state,
  projectId,
  currentBranch,
  label,
  className,
  isUnborn = false,
}: BranchPickerFieldProps) {
  const { t } = useTranslation();
  const { createBranchAndWorktree, setCreateBranchAndWorktree, pushBranch, setPushBranch } = state;
  const displayLabel = label ?? t('tasks.create.fromBranch');

  return (
    <div className={cn('border border-border rounded-md overflow-hidden', className)}>
      {!createBranchAndWorktree && currentBranch ? (
        <BranchDisplay label={displayLabel} branchName={currentBranch} />
      ) : projectId ? (
        <ProjectBranchSelector
          projectId={projectId}
          value={state.selectedBranch}
          onValueChange={state.setSelectedBranch}
          trigger={
            <ComboboxTrigger className="flex w-full items-center gap-2 justify-between hover:bg-background-1 data-popup-open:bg-background-1 p-2 outline-none">
              <div className="flex flex-col text-left text-sm gap-0.5">
                <span className="text-foreground-passive text-xs">{displayLabel}</span>
                <span className="flex items-center gap-1">
                  <GitBranch
                    absoluteStrokeWidth
                    strokeWidth={2}
                    className="size-3.5 shrink-0 text-foreground-muted"
                  />
                  <ComboboxValue placeholder={t('branchSelector.selectBranch')} />
                </span>
              </div>

              <ChevronDown className="size-4 shrink-0 text-foreground-muted" />
            </ComboboxTrigger>
          }
        />
      ) : null}
      {!isUnborn && (
        <div className="border-t border-border p-2 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm text-foreground-muted select-none">
            <Switch
              checked={createBranchAndWorktree}
              onCheckedChange={setCreateBranchAndWorktree}
            />
            <span
              className="cursor-pointer"
              onClick={() => setCreateBranchAndWorktree(!createBranchAndWorktree)}
            >
              {t('tasks.create.createTaskBranchAndWorktree')}
            </span>
          </div>
          {createBranchAndWorktree && (
            <div className="flex items-center gap-2 text-sm text-foreground-muted select-none">
              <Switch checked={pushBranch} onCheckedChange={setPushBranch} />
              <span className="cursor-pointer" onClick={() => setPushBranch(!pushBranch)}>
                {t('tasks.create.pushBranchToRemote')}
              </span>
            </div>
          )}
        </div>
      )}
      {isUnborn && (
        <p className="border-t border-border bg-background-1 px-2 py-1 text-xs text-foreground-muted">
          {t('tasks.create.initialCommitRequired')}
        </p>
      )}
    </div>
  );
}
