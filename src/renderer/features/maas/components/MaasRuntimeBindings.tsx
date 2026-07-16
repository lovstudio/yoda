import { Loader2, RotateCcw } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { MAAS_PLATFORMS, supportsMaasPlatformForRuntime, type MaasPlatformId } from '@shared/maas';
import { getRuntime, isValidRuntimeId, type RuntimeId } from '@shared/runtime-registry';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { Button } from '@renderer/lib/ui/button';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import { useMaasRuntimeBindings, useSetMaasRuntimeBinding } from '../useMaas';

export const MaasRuntimeBindings: React.FC<{
  platformId: MaasPlatformId;
  connected: boolean;
  currentRuntimeId?: RuntimeId | null;
  compact?: boolean;
}> = ({ platformId, connected, currentRuntimeId, compact = false }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const bindings = useMaasRuntimeBindings(platformId);
  const setBinding = useSetMaasRuntimeBinding();

  const updateBinding = (runtimeId: string, enabled: boolean) => {
    setBinding.mutate(
      { runtimeId, platformId, enabled },
      {
        onSuccess: () => {
          toast({
            title: enabled
              ? t('maas.clients.enabledToast', {
                  client: getRuntime(runtimeId as RuntimeId)?.name ?? runtimeId,
                  platform: MAAS_PLATFORMS[platformId].name,
                })
              : t('maas.clients.restoredToast', {
                  client: getRuntime(runtimeId as RuntimeId)?.name ?? runtimeId,
                }),
          });
        },
        onError: (error) => {
          toast({
            title: t('maas.clients.updateFailed'),
            description: error instanceof Error ? error.message : String(error),
            variant: 'destructive',
          });
        },
      }
    );
  };

  return (
    <section className={cn('grid gap-2', !compact && 'border-t border-border/50 pt-4')}>
      {!compact && (
        <div>
          <h4 className="text-xs font-medium text-foreground">{t('maas.clients.title')}</h4>
          <p className="mt-1 text-xs leading-relaxed text-foreground-muted">
            {t('maas.clients.description')}
          </p>
        </div>
      )}

      {bindings.isLoading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-foreground-muted">
          <Loader2 className="size-3.5 animate-spin" />
          {t('maas.clients.loading')}
        </div>
      ) : (
        <div className="divide-y divide-border/50 overflow-hidden rounded-lg border border-border/60">
          {bindings.data?.map((binding) => {
            if (!isValidRuntimeId(binding.runtimeId)) return null;
            if (!supportsMaasPlatformForRuntime(binding.runtimeId, platformId)) return null;
            const runtime = getRuntime(binding.runtimeId);
            const config = agentConfig[binding.runtimeId];
            const selectedHere = binding.bound && binding.platformId === platformId;
            const checked = selectedHere && binding.effective;
            const busy =
              setBinding.isPending && setBinding.variables?.runtimeId === binding.runtimeId;
            const status = checked
              ? t('maas.clients.effective')
              : selectedHere
                ? t('maas.clients.needsAttention')
                : binding.bound && binding.platformId
                  ? t('maas.clients.boundElsewhere', {
                      platform: MAAS_PLATFORMS[binding.platformId].name,
                    })
                  : t('maas.clients.notEnabled');

            return (
              <div
                key={binding.runtimeId}
                className={cn(
                  'flex min-w-0 items-center gap-2.5 px-3 py-2',
                  currentRuntimeId === binding.runtimeId && 'bg-background-2/70'
                )}
              >
                <Checkbox
                  checked={checked}
                  disabled={busy || (!connected && !selectedHere)}
                  aria-label={t('maas.clients.toggleAria', {
                    client: runtime?.name ?? binding.runtimeId,
                    platform: MAAS_PLATFORMS[platformId].name,
                  })}
                  onCheckedChange={(next) => updateBinding(binding.runtimeId, next === true)}
                />
                {config ? (
                  <AgentLogo
                    logo={config.logo}
                    alt=""
                    isSvg={config.isSvg}
                    invertInDark={config.invertInDark}
                    className="size-4 rounded-[2px]"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-foreground">
                    {runtime?.name ?? binding.runtimeId}
                  </div>
                  <div
                    className={cn(
                      'truncate text-[11px]',
                      checked ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground-muted'
                    )}
                  >
                    {status}
                  </div>
                </div>
                {busy ? (
                  <Loader2 className="size-3.5 shrink-0 animate-spin text-foreground-muted" />
                ) : selectedHere ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => updateBinding(binding.runtimeId, false)}
                  >
                    <RotateCcw className="size-3.5" />
                    {t('maas.clients.restore')}
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {!connected && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          {t('maas.clients.connectFirst')}
        </p>
      )}
    </section>
  );
};
