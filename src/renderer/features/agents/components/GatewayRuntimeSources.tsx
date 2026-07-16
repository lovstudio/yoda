import { useQuery } from '@tanstack/react-query';
import { Loader2, Settings2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { MAAS_PLATFORMS, type MaasRuntimeBindingStatus } from '@shared/maas';
import {
  getRuntime,
  getRuntimeAccountProfile,
  RUNTIME_IDS,
  supportsRuntimeMaasSwitch,
  type AgentAccountProviderId,
  type AgentSubscriptionAccount,
  type RuntimeAccountStatus,
  type RuntimeId,
} from '@shared/runtime-registry';
import { useMaasRuntimeBindings } from '@renderer/features/maas/useMaas';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import { resolveDefaultGatewaySource } from '../gateway-source';
import { useRuntimeGatewaySource } from '../use-runtime-gateway-source';

type GatewaySelection =
  | Exclude<AgentAccountProviderId, 'yoda-maas'>
  | `yoda-maas:${MaasRuntimeBindingStatus['platformId'] & string}`;

export const GatewayRuntimeSources: React.FC<{
  currentRuntimeId?: RuntimeId | null;
}> = observer(function GatewayRuntimeSources({ currentRuntimeId }) {
  const { t } = useTranslation();
  const bindings = useMaasRuntimeBindings();

  if (bindings.isLoading) {
    return (
      <div className="flex items-center gap-2 py-3 text-xs text-foreground-muted">
        <Loader2 className="size-3.5 animate-spin" />
        {t('workspaceRuntime.gateway.loading')}
      </div>
    );
  }

  const runtimeIds = RUNTIME_IDS.filter((runtimeId) => {
    const detected = appState.dependencies.agentStatuses[runtimeId]?.status === 'available';
    const bound = bindings.data?.some((binding) => binding.runtimeId === runtimeId) ?? false;
    return detected || bound || runtimeId === currentRuntimeId;
  });

  return (
    <div className="max-h-72 divide-y divide-border/50 overflow-y-auto rounded-lg border border-border/60">
      {runtimeIds.map((runtimeId) => {
        const binding = bindings.data?.find((item) => item.runtimeId === runtimeId) ?? {
          runtimeId,
          platformId: null,
          supported: supportsRuntimeMaasSwitch(runtimeId),
          bound: false,
          effective: false,
          connected: false,
          enabledAt: null,
        };
        return (
          <GatewayRuntimeSourceRow
            key={runtimeId}
            binding={binding}
            runtimeId={runtimeId}
            current={runtimeId === currentRuntimeId}
          />
        );
      })}
    </div>
  );
});

const GatewayRuntimeSourceRow: React.FC<{
  runtimeId: RuntimeId;
  binding: MaasRuntimeBindingStatus;
  current: boolean;
}> = observer(function GatewayRuntimeSourceRow({ runtimeId, binding, current }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const runtime = getRuntime(runtimeId);
  const profile = getRuntimeAccountProfile(runtimeId);
  const config = agentConfig[runtimeId];
  const dependency = appState.dependencies.agentStatuses[runtimeId];
  const runtimeDetected = dependency?.status === 'available';
  const {
    providerConfig,
    providerSettingsLoading,
    connectedMaasConnections,
    selectAuthProvider,
    isSaving,
  } = useRuntimeGatewaySource(runtimeId);
  const accountStatus = useQuery<RuntimeAccountStatus>({
    queryKey: ['runtimeSettings', runtimeId, 'runtimeAccountStatus'] as const,
    queryFn: () =>
      rpc.runtimeSettings.getRuntimeAccountStatus(runtimeId) as Promise<RuntimeAccountStatus>,
    staleTime: 30_000,
  });
  const subscriptionAccount = useQuery<AgentSubscriptionAccount>({
    queryKey: ['runtimeSettings', runtimeId, 'subscriptionAccount'] as const,
    queryFn: () =>
      rpc.runtimeSettings.getSubscriptionAccount(runtimeId) as Promise<AgentSubscriptionAccount>,
    enabled: profile.officialSubscription.supported && runtimeDetected,
    staleTime: 30_000,
  });
  const configuredApiCount = accountStatus.data?.configuredApiEnvVars.length ?? 0;
  const subscriptionReady =
    runtimeDetected && (!subscriptionAccount.data?.supported || subscriptionAccount.data.loggedIn);
  const availability: Record<AgentAccountProviderId, boolean> = {
    'official-subscription': profile.officialSubscription.supported && runtimeDetected,
    'official-api': configuredApiCount > 0,
    'yoda-maas': connectedMaasConnections.length > 0,
  };
  const selectedAuthProvider =
    providerConfig?.authProvider ?? resolveDefaultGatewaySource(availability);
  const selection: GatewaySelection | null =
    selectedAuthProvider === 'yoda-maas' && providerConfig?.maasPlatformId
      ? `yoda-maas:${providerConfig.maasPlatformId}`
      : selectedAuthProvider === 'official-api' || selectedAuthProvider === 'official-subscription'
        ? selectedAuthProvider
        : null;
  const selectedLabel = gatewaySourceLabel(
    t,
    selectedAuthProvider,
    providerConfig?.maasPlatformId ?? null
  );
  const ready =
    selectedAuthProvider === 'yoda-maas'
      ? binding.effective
      : selectedAuthProvider === 'official-api'
        ? configuredApiCount > 0
        : selectedAuthProvider === 'official-subscription'
          ? subscriptionReady
          : false;

  const updateSelection = (value: GatewaySelection | null) => {
    if (!value) return;
    const [authProvider, platformId] = value.split(':') as [
      AgentAccountProviderId,
      MaasRuntimeBindingStatus['platformId']?,
    ];
    selectAuthProvider(authProvider, platformId ?? undefined, {
      onSuccess: () =>
        toast({
          title: t('workspaceRuntime.gateway.updated', {
            client: runtime?.name ?? runtimeId,
          }),
        }),
      onError: (error) =>
        toast({
          title: t('workspaceRuntime.gateway.updateFailed'),
          description: error.message,
          variant: 'destructive',
        }),
    });
  };

  return (
    <div
      className={cn('flex min-w-0 items-center gap-2.5 px-3 py-2', current && 'bg-background-2/70')}
    >
      <AgentLogo
        logo={config.logo}
        alt=""
        isSvg={config.isSvg}
        invertInDark={config.invertInDark}
        className="size-4 rounded-[2px]"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-foreground">
          {runtime?.name ?? runtimeId}
        </div>
        <div
          className={cn(
            'truncate text-[11px]',
            ready ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground-muted'
          )}
        >
          {selectedLabel} ·{' '}
          {ready
            ? t('workspaceRuntime.gateway.ready')
            : t('workspaceRuntime.gateway.needsConfiguration')}
        </div>
      </div>
      <Select
        value={selection}
        disabled={providerSettingsLoading || isSaving}
        onValueChange={(value) => updateSelection(value as GatewaySelection | null)}
      >
        <SelectTrigger size="sm" className="h-7 w-36 text-[11px]">
          {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : null}
          <SelectValue>{selectedLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent align="end" alignItemWithTrigger={false}>
          <SelectGroup>
            <SelectLabel>{t('workspaceRuntime.gateway.directSources')}</SelectLabel>
            <SelectItem
              value="official-subscription"
              disabled={!availability['official-subscription']}
            >
              {t('workspaceRuntime.gateway.subscription')}
            </SelectItem>
            <SelectItem value="official-api" disabled={!availability['official-api']}>
              {t('workspaceRuntime.gateway.apiKey')}
            </SelectItem>
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>{t('workspaceRuntime.gateway.maasSources')}</SelectLabel>
            {connectedMaasConnections.map((connection) => (
              <SelectItem
                key={connection.platformId}
                value={`yoda-maas:${connection.platformId}` as GatewaySelection}
              >
                {MAAS_PLATFORMS[connection.platformId].name}
              </SelectItem>
            ))}
            {connectedMaasConnections.length === 0 ? (
              <SelectItem value="yoda-maas:unavailable" disabled>
                {t('workspaceRuntime.gateway.noMaas')}
              </SelectItem>
            ) : null}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        title={t('workspaceRuntime.gateway.manageClient', {
          client: runtime?.name ?? runtimeId,
        })}
        aria-label={t('workspaceRuntime.gateway.manageClient', {
          client: runtime?.name ?? runtimeId,
        })}
        onClick={() => appState.sidePane.pinView('settings', { tab: 'clis-models', runtimeId })}
      >
        <Settings2 className="size-3.5" />
      </Button>
    </div>
  );
});

function gatewaySourceLabel(
  t: (key: string) => string,
  authProvider: AgentAccountProviderId | null,
  platformId: MaasRuntimeBindingStatus['platformId']
): string {
  if (authProvider === 'yoda-maas') {
    return platformId ? MAAS_PLATFORMS[platformId].name : t('workspaceRuntime.gateway.maas');
  }
  if (authProvider === 'official-api') return t('workspaceRuntime.gateway.apiKey');
  if (authProvider === 'official-subscription') return t('workspaceRuntime.gateway.subscription');
  return t('workspaceRuntime.gateway.unconfigured');
}
