import { Loader2, Settings2 } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  hasMaasInferenceCredential,
  MAAS_PLATFORM_IDS,
  MAAS_PLATFORMS,
  type MaasPlatformId,
} from '@shared/maas';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { Button } from '@renderer/lib/ui/button';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { cn } from '@renderer/utils/utils';
import { useMaasConnections, useMaasGlobalBinding, useSetMaasGlobalBinding } from '../useMaas';

export const MaasGlobalSelector: React.FC<{
  platformId?: MaasPlatformId;
  onManagePlatform?: (platformId: MaasPlatformId) => void;
}> = ({ platformId, onManagePlatform }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const connections = useMaasConnections();
  const binding = useMaasGlobalBinding();
  const setBinding = useSetMaasGlobalBinding();
  const platformIds = platformId ? [platformId] : MAAS_PLATFORM_IDS;

  const updateBinding = (nextPlatformId: MaasPlatformId, enabled: boolean) => {
    setBinding.mutate(
      { platformId: nextPlatformId, enabled },
      {
        onSuccess: () => {
          toast({
            title: enabled
              ? t('maas.global.enabledToast', {
                  platform: MAAS_PLATFORMS[nextPlatformId].name,
                })
              : t('maas.global.restoredToast'),
          });
        },
        onError: (error) => {
          toast({
            title: t('maas.global.updateFailed'),
            description: error instanceof Error ? error.message : String(error),
            variant: 'destructive',
          });
        },
      }
    );
  };

  return (
    <section className={cn('grid gap-2', platformId && 'border-t border-border/50 pt-4')}>
      {platformId ? (
        <div>
          <h4 className="text-xs font-medium text-foreground">{t('maas.global.title')}</h4>
          <p className="mt-1 text-xs leading-relaxed text-foreground-muted">
            {t('maas.global.description')}
          </p>
        </div>
      ) : null}

      {binding.isLoading || connections.isLoading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-foreground-muted">
          <Loader2 className="size-3.5 animate-spin" />
          {t('maas.global.loading')}
        </div>
      ) : (
        <div className="divide-y divide-border/50 overflow-hidden rounded-lg border border-border/60">
          {platformIds.map((nextPlatformId) => {
            const platform = MAAS_PLATFORMS[nextPlatformId];
            const connection = connections.data?.find((item) => item.platformId === nextPlatformId);
            const available = Boolean(
              connection?.connected && hasMaasInferenceCredential(connection)
            );
            const checked = Boolean(
              binding.data?.enabled && binding.data.platformId === nextPlatformId
            );
            const effective = checked && binding.data?.effective;
            const busy =
              setBinding.isPending && setBinding.variables?.platformId === nextPlatformId;

            return (
              <div key={nextPlatformId} className="flex min-w-0 items-center gap-2.5 px-3 py-2.5">
                <Checkbox
                  checked={checked}
                  disabled={setBinding.isPending || (!available && !checked)}
                  aria-label={t('maas.global.toggleAria', { platform: platform.name })}
                  onCheckedChange={(next) => updateBinding(nextPlatformId, next === true)}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-foreground">
                    {platform.name}
                  </div>
                  <div
                    className={cn(
                      'truncate text-[11px]',
                      effective
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : checked
                          ? 'text-amber-700 dark:text-amber-300'
                          : 'text-foreground-muted'
                    )}
                  >
                    {effective
                      ? t('maas.global.effective', {
                          count: binding.data?.runtimeIds.length ?? 0,
                        })
                      : checked
                        ? t('maas.global.needsAttention')
                        : available
                          ? t('maas.global.notEnabled')
                          : t('maas.global.needsConfiguration')}
                  </div>
                </div>
                {busy ? (
                  <Loader2 className="size-3.5 shrink-0 animate-spin text-foreground-muted" />
                ) : onManagePlatform ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    title={t('maas.global.manage', { platform: platform.name })}
                    aria-label={t('maas.global.manage', { platform: platform.name })}
                    onClick={() => onManagePlatform(nextPlatformId)}
                  >
                    <Settings2 className="size-3.5" />
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
