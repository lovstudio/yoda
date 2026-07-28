import { Loader2, Store } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/lib/ui/button';
import { cn } from '@renderer/utils/utils';
import type { MaasGatewayAvailability } from '../maas-gateway-availability';

export function MaasGatewayRequirement({
  availability,
  onOpenMarketplace,
  compact = false,
}: {
  availability: MaasGatewayAvailability;
  onOpenMarketplace?: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  if (availability === 'ready') return null;

  return (
    <div
      data-maas-gateway-requirement={availability}
      className={cn(
        'flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5',
        compact ? 'p-2.5' : 'p-3'
      )}
    >
      {availability === 'loading' ? (
        <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-amber-700 dark:text-amber-300" />
      ) : (
        <Store className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-foreground">
          {t('maas.gatewayRequirement.title')}
        </div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-foreground-muted">
          {t(`maas.gatewayRequirement.states.${availability}`)}
        </p>
      </div>
      {availability !== 'loading' && onOpenMarketplace ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={onOpenMarketplace}
        >
          {t(
            availability === 'not-installed'
              ? 'maas.gatewayRequirement.install'
              : 'maas.gatewayRequirement.manage'
          )}
        </Button>
      ) : null}
    </div>
  );
}
