import { CircleAlert, Loader2, Star } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';

type ManagedGatewayCardShellProps = {
  testId: string;
  icon: ReactNode;
  name: string;
  description: ReactNode;
  actions: ReactNode;
  starCount?: number | null;
};

function formatStarCount(starCount: number): string {
  return new Intl.NumberFormat().format(starCount);
}

function ManagedGatewayStarCount({ starCount }: { starCount?: number | null }) {
  const { t } = useTranslation();
  const isLoading = starCount === undefined;
  const isUnavailable = starCount === null;
  const label = isLoading
    ? t('maas.managedGateways.githubStarsLoading')
    : isUnavailable
      ? t('maas.managedGateways.githubStarsUnavailable')
      : t('maas.managedGateways.githubStars', { count: formatStarCount(starCount) });

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="status"
            tabIndex={0}
            aria-label={label}
            className="inline-flex h-5 shrink-0 items-center gap-1 rounded border border-border/60 bg-background/50 px-1.5 text-[10px] font-medium text-foreground-muted outline-none transition-colors focus-visible:ring-1 focus-visible:ring-border"
          >
            {isLoading ? (
              <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            ) : isUnavailable ? (
              <CircleAlert className="size-3 text-amber-500" aria-hidden="true" />
            ) : (
              <Star className="size-3 fill-amber-400 text-amber-500" aria-hidden="true" />
            )}
            <span>{isLoading ? '…' : isUnavailable ? '—' : formatStarCount(starCount)}</span>
          </span>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ManagedGatewayCardShell({
  testId,
  icon,
  name,
  description,
  actions,
  starCount,
}: ManagedGatewayCardShellProps) {
  return (
    <div className="flex h-full min-h-0" data-testid={testId}>
      <div className="flex w-full items-center gap-4 rounded-lg border border-muted bg-muted/20 p-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted/50">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h4 className="text-sm font-medium text-foreground">{name}</h4>
            <ManagedGatewayStarCount starCount={starCount} />
          </div>
          <p className="mt-0.5 line-clamp-2 text-sm leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
        {actions}
      </div>
    </div>
  );
}
