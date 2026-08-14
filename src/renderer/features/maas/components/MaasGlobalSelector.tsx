import { Loader2, Settings2 } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  getMaasPlatformDefinition,
  hasMaasInferenceCredential,
  type MaasPlatformId,
} from '@shared/maas';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { Button } from '@renderer/lib/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { cn } from '@renderer/utils/utils';
import { useMaasConnections, useMaasGlobalBinding, useSetMaasGlobalBinding } from '../useMaas';

const DISABLED_PLATFORM_VALUE = '__maas-disabled__';

export const MaasGlobalSelector: React.FC<{
  platformId?: MaasPlatformId;
  onManagePlatform?: (platformId: MaasPlatformId) => void;
  onOpenMarketplace?: () => void;
  showSelectedStatus?: boolean;
}> = ({ platformId, onManagePlatform, showSelectedStatus = true }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const connections = useMaasConnections();
  const binding = useMaasGlobalBinding();
  const setBinding = useSetMaasGlobalBinding();
  const platformIds = platformId
    ? [platformId]
    : (connections.data?.map((connection) => connection.platformId) ?? []);
  const profiles = platformIds.map((nextPlatformId) => {
    const platform = getMaasPlatformDefinition(nextPlatformId);
    const connection = connections.data?.find((item) => item.platformId === nextPlatformId);
    const platformName = connection?.displayName ?? platform.name;
    const platformConfigured = Boolean(
      connection?.connected && hasMaasInferenceCredential(connection)
    );
    const available = platformConfigured && connection?.lastTest?.ok === true;
    const selected = Boolean(binding.data?.enabled && binding.data.platformId === nextPlatformId);
    const effective = selected && binding.data?.effective;
    const status = effective
      ? t('maas.global.effective', {
          count: binding.data?.runtimeIds.length ?? 0,
        })
      : selected
        ? t('maas.global.needsAttention')
        : available
          ? t('maas.global.notEnabled')
          : connection?.lastTest?.ok
            ? t('maas.global.needsConfiguration')
            : t('maas.global.needsSuccessfulTest');

    return {
      platformId: nextPlatformId,
      platformName,
      available,
      selected,
      effective,
      status,
    };
  });
  const selectedProfile = profiles.find((profile) => profile.selected) ?? null;
  const selectedValue = selectedProfile?.platformId ?? DISABLED_PLATFORM_VALUE;
  const manageProfile = selectedProfile ?? (platformId ? profiles[0] : null);

  const updateBinding = (nextPlatformId: MaasPlatformId, enabled: boolean) => {
    const connection = connections.data?.find((item) => item.platformId === nextPlatformId);
    const platformName = connection?.displayName ?? getMaasPlatformDefinition(nextPlatformId).name;
    setBinding.mutate(
      { platformId: nextPlatformId, enabled },
      {
        onSuccess: () => {
          toast({
            title: enabled
              ? t('maas.global.enabledToast', {
                  platform: platformName,
                })
              : t('maas.global.restoredToast'),
            description: t('maas.global.codexRestartNotice'),
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

  const selectProfile = (nextValue: string | null) => {
    if (!nextValue) return;
    if (nextValue === DISABLED_PLATFORM_VALUE) {
      if (binding.data?.enabled && binding.data.platformId) {
        updateBinding(binding.data.platformId, false);
      }
      return;
    }

    const nextProfile = profiles.find((profile) => profile.platformId === nextValue);
    if (!nextProfile) return;
    if (!nextProfile.available && !nextProfile.selected) {
      onManagePlatform?.(nextProfile.platformId);
      return;
    }
    updateBinding(nextProfile.platformId, true);
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
        <div className="flex min-w-0 items-center gap-2">
          <Select
            value={selectedValue}
            disabled={setBinding.isPending || profiles.length === 0}
            onValueChange={selectProfile}
          >
            <SelectTrigger
              size="sm"
              className="h-8 min-w-0 flex-1 px-2.5 text-xs"
              aria-label={t('maas.global.title')}
            >
              <SelectValue>
                {selectedProfile ? (
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                      {selectedProfile.platformName}
                    </span>
                    {showSelectedStatus ? (
                      <span
                        className={cn(
                          'shrink-0 truncate text-[10px]',
                          selectedProfile.effective
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-amber-700 dark:text-amber-300'
                        )}
                      >
                        {selectedProfile.status}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-foreground-muted">{t('maas.global.disabled')}</span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent
              align="start"
              alignItemWithTrigger={false}
              className="min-w-(--anchor-width)"
            >
              <SelectItem value={DISABLED_PLATFORM_VALUE}>
                <span className="text-xs text-foreground-muted">{t('maas.global.disabled')}</span>
              </SelectItem>
              {profiles.map((profile) => (
                <SelectItem
                  key={profile.platformId}
                  value={profile.platformId}
                  disabled={!profile.available && !profile.selected && !onManagePlatform}
                  className="py-2"
                >
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate text-xs font-medium text-foreground">
                      {profile.platformName}
                    </span>
                    <span
                      className={cn(
                        'truncate text-[10px]',
                        profile.effective
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : profile.selected
                            ? 'text-amber-700 dark:text-amber-300'
                            : 'text-foreground-muted'
                      )}
                    >
                      {profile.status}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {setBinding.isPending ? (
            <span className="flex size-7 shrink-0 items-center justify-center">
              <Loader2 className="size-3.5 animate-spin text-foreground-muted" />
            </span>
          ) : onManagePlatform && manageProfile ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              title={t('maas.global.manage', { platform: manageProfile.platformName })}
              aria-label={t('maas.global.manage', { platform: manageProfile.platformName })}
              onClick={() => onManagePlatform(manageProfile.platformId)}
            >
              <Settings2 className="size-3.5" />
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
};
