import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getPrNumber, type PullRequest } from '@shared/pull-requests';
import { PrMergeLine } from '@renderer/lib/components/pr-merge-line';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { cn } from '@renderer/utils/utils';
import { rpc } from '../ipc';
import { Button } from '../ui/button';
import { RelativeTime } from '../ui/relative-time';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { PrNumberBadge } from './pr-number-badge';
import { StatusIcon } from './pr-status-icon';

interface PrBadgeProps {
  variant?: 'default' | 'compact';
  pr: PullRequest;
  className?: string;
}

export function PrBadge({ variant = 'default', pr, className }: PrBadgeProps) {
  const { t } = useTranslation();
  const renderBadge = () => {
    switch (variant) {
      case 'default':
        return (
          <div
            className={cn(
              'flex items-center gap-2 px-1.5 py-0.5 rounded-md bg-background-2 max-w-52',
              className
            )}
          >
            <StatusIcon className="size-3" status={pr.status} disableTooltip />
            <PrNumberBadge number={getPrNumber(pr) ?? 0} className="text-[10px]" />
            <span className="text-xs text-foreground-muted truncate">{pr.title}</span>
          </div>
        );
      case 'compact':
        return (
          <div className={cn('px-1 flex items-center justify-center', className)}>
            <StatusIcon className="size-3" status={pr.status} disableTooltip />
          </div>
        );
    }
  };

  return (
    <Popover>
      <PopoverTrigger openOnHover>{renderBadge()}</PopoverTrigger>
      <PopoverContent className="gap-2.5 p-3">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2">
            <StatusIcon status={pr.status} className="size-3.5" />
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 truncate text-sm leading-snug text-foreground">
                {pr.title}
              </span>
              <PrNumberBadge number={getPrNumber(pr) ?? 0} className="shrink-0 text-[10px]" />
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="size-5 cursor-pointer"
                      onClick={() => rpc.app.openExternal(pr.url)}
                    >
                      <ExternalLink className="size-3.5" />
                    </Button>
                  }
                />
                <TooltipContent>{t('pullRequests.openOnGitHub')}</TooltipContent>
              </Tooltip>
              <RelativeTime
                value={pr.createdAt}
                className="min-w-8 text-right text-[11px] text-foreground-passive"
                compact
              />
            </div>
          </div>
          <PrMergeLine pr={pr} className="pl-[22px] text-[11px] leading-4" />
        </div>
      </PopoverContent>
    </Popover>
  );
}
