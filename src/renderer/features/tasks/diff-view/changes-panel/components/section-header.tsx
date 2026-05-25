import { ChevronDown, Plus, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { type SelectionState } from '@renderer/features/tasks/diff-view/stores/changes-view-store';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { SplitButton, type SplitButtonAction } from '@renderer/lib/ui/split-button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';

interface SectionHeaderProps {
  label: string;
  count: number;
  selectionState: SelectionState;
  onToggleAll: () => void;
  actions?: React.ReactNode;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export function SectionHeader({
  label,
  count,
  selectionState,
  onToggleAll,
  actions,
  collapsed,
  onToggleCollapsed,
}: SectionHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="shrink-0 flex items-center justify-between px-3.5 h-10">
      <div className="flex items-center gap-2 justify-between w-full">
        <button onClick={onToggleCollapsed}>
          <span className="text-sm text-foreground-muted flex items-center gap-2">
            <span>{label}</span> <Badge variant="secondary">{count}</Badge>{' '}
            <span className="p-2 text-foreground-muted hover:text-foreground">
              <ChevronDown
                className={cn(
                  'size-4 transition-transform duration-200 ease-in-out',
                  collapsed ? '-rotate-90' : 'rotate-0'
                )}
              />
            </span>
          </span>
        </button>
        <Checkbox
          checked={selectionState === 'all'}
          indeterminate={selectionState === 'partial'}
          onCheckedChange={onToggleAll}
          aria-label={t('common.selectAllLabel', { label: label.toLowerCase() })}
          className="mr-0.5"
        />
      </div>
      {actions}
    </div>
  );
}

export function PullRequestSectionHeader({
  count,
  collapsed,
  onToggleCollapsed,
  hasOpenPr,
  onCreatePr,
  onCreateDraftPr,
  onRefresh,
  isRefreshing,
}: {
  count: number;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  hasOpenPr: boolean;
  onCreatePr?: () => void;
  onCreateDraftPr?: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}) {
  const { t } = useTranslation();
  const prActions: SplitButtonAction[] = [
    {
      value: 'create-pr',
      label: t('pullRequests.createPr'),
      action: () => onCreatePr?.(),
    },
    {
      value: 'create-draft-pr',
      label: t('pullRequests.createDraftPr'),
      action: () => onCreateDraftPr?.(),
    },
  ];

  return (
    <div className="shrink-0 flex items-center justify-between px-3.5 h-10">
      <div className="flex items-center gap-2 justify-between w-full min-w-0">
        <button onClick={onToggleCollapsed} className="min-w-0">
          <span className="text-sm text-foreground-muted flex items-center gap-2 min-w-0">
            <span className="truncate">{t('pullRequests.title')}</span>{' '}
            <Badge variant="secondary" className="shrink-0">
              {count}
            </Badge>
            <span className="p-2 text-foreground-muted hover:text-foreground">
              <ChevronDown
                className={cn(
                  'size-4 transition-transform duration-200 ease-in-out',
                  collapsed ? '-rotate-90' : 'rotate-0'
                )}
              />
            </span>
          </span>
        </button>
        <div className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger>
              <SplitButton
                variant="outline"
                size="xs"
                actions={prActions}
                disabled={hasOpenPr || !onCreatePr || !onCreateDraftPr}
                icon={<Plus className="size-3" />}
              />
            </TooltipTrigger>
            <TooltipContent>
              {hasOpenPr ? t('pullRequests.alreadyOpen') : t('pullRequests.createPullRequest')}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-xs"
                  onClick={onRefresh}
                  disabled={isRefreshing}
                >
                  <RefreshCw className={cn('size-3', isRefreshing && 'animate-spin')} />
                </Button>
              }
            />
            <TooltipContent>{t('pullRequests.refresh')}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
