import { ChevronDown, Loader2 } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  getMaasPlatformDefinition,
  hasMaasInferenceCredential,
  type MaasPlatformId,
} from '@shared/maas';
import { useToast } from '@renderer/lib/hooks/use-toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { Switch } from '@renderer/lib/ui/switch';
import { cn } from '@renderer/utils/utils';
import { useMaasConnections, useMaasGlobalBinding, useSetMaasGlobalBinding } from '../useMaas';

/**
 * Picks which Profile is globally in effect. Selection only — configuring a
 * Profile lives in Settings → Model access, reached from the surrounding
 * surface's overflow menu, so this control never navigates away.
 */
export const MaasGlobalSelector: React.FC<{
  platformId?: MaasPlatformId;
  showSelectedStatus?: boolean;
}> = ({ platformId, showSelectedStatus = true }) => {
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
    const unavailableReason = connection?.lastTest?.ok
      ? t('maas.global.needsConfiguration')
      : t('maas.global.needsSuccessfulTest');
    const status = effective
      ? t('maas.global.effective', {
          count: binding.data?.runtimeIds.length ?? 0,
        })
      : selected
        ? t('maas.global.needsAttention')
        : available
          ? t('maas.global.notEnabled')
          : unavailableReason;

    return {
      platformId: nextPlatformId,
      platformName,
      available,
      selected,
      effective,
      status,
      unavailableReason,
    };
  });
  const selectedProfile = profiles.find((profile) => profile.selected) ?? null;

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
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={profiles.length === 0}
              aria-label={t('maas.global.title')}
              className="flex h-8 min-w-0 flex-1 items-center justify-between gap-1.5 rounded-md border border-border bg-transparent px-2.5 text-xs outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {selectedProfile ? (
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-left font-medium text-foreground">
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
                <span className="min-w-0 flex-1 truncate text-left text-foreground-muted">
                  {t('maas.global.disabled')}
                </span>
              )}
              <ChevronDown aria-hidden className="size-3.5 shrink-0 text-foreground-muted" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-(--anchor-width)">
              {profiles.map((profile) => {
                const togglePending =
                  setBinding.isPending && setBinding.variables?.platformId === profile.platformId;
                const toggleLabel = profile.selected
                  ? t('maas.global.disableAria', { platform: profile.platformName })
                  : t('maas.global.enableAria', { platform: profile.platformName });
                const toggleDisabled =
                  setBinding.isPending || (!profile.available && !profile.selected);
                return (
                  <DropdownMenuItem
                    key={profile.platformId}
                    data-maas-platform-id={profile.platformId}
                    title={
                      toggleDisabled && !profile.selected ? profile.unavailableReason : toggleLabel
                    }
                    disabled={toggleDisabled}
                    onClick={() => updateBinding(profile.platformId, !profile.selected)}
                    className="gap-2.5 py-1.5"
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
                    {togglePending ? (
                      <Loader2 className="size-3.5 shrink-0 animate-spin text-foreground-muted" />
                    ) : (
                      <Switch
                        size="sm"
                        checked={profile.selected}
                        disabled={toggleDisabled}
                        aria-label={toggleLabel}
                        title={
                          toggleDisabled && !profile.selected
                            ? profile.unavailableReason
                            : toggleLabel
                        }
                        onCheckedChange={(checked) => updateBinding(profile.platformId, checked)}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                      />
                    )}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </section>
  );
};
