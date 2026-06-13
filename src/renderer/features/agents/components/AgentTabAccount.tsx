import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, ExternalLink, RefreshCw, XCircle } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAAS_PLATFORMS, type MaasConnection, type MaasUsageSummary } from '@shared/maas';
import {
  AGENT_ACCOUNT_PROVIDER_IDS,
  getRuntime,
  getRuntimeAccountProfile,
  type AgentAccountProviderId,
  type AgentLocalUsage,
  type AgentSubscriptionAccount,
  type RuntimeAccountStatus,
  type RuntimeId,
} from '@shared/runtime-registry';
import {
  useCheckMaasConnection,
  useMaasConnections,
  useMaasUsageSummary,
} from '@renderer/features/maas/useMaas';
import { useRuntimeSettings } from '@renderer/features/settings/use-runtime-settings';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { RadioGroup, RadioGroupItem } from '@renderer/lib/ui/radio-group';
import { isImeComposing } from '@renderer/utils/ime';
import { cn } from '@renderer/utils/utils';
import { AgentSection } from './AgentSection';

type AgentTabAccountProps = {
  agentId: RuntimeId;
};

const DEFAULT_AUTH_PROVIDER_ORDER: AgentAccountProviderId[] = [
  'official-api',
  'official-subscription',
  'yoda-maas',
];

function resolveDefaultAuthProvider(
  availability: Record<AgentAccountProviderId, boolean>
): AgentAccountProviderId | null {
  return DEFAULT_AUTH_PROVIDER_ORDER.find((id) => availability[id]) ?? null;
}

function findConnection(
  connections: MaasConnection[] | undefined,
  platformId: MaasConnection['platformId']
): MaasConnection {
  return (
    connections?.find((connection) => connection.platformId === platformId) ?? {
      platformId,
      displayName: MAAS_PLATFORMS[platformId].name,
      endpoint: MAAS_PLATFORMS[platformId].defaultEndpoint,
      keyFingerprint: null,
      connectedAt: null,
      lastCheckedAt: null,
      connected: false,
      error: null,
    }
  );
}

function formatCompactNumber(value: number | null): string {
  if (typeof value !== 'number') return '-';
  return new Intl.NumberFormat(undefined, {
    notation: value >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 10000 ? 1 : 0,
  }).format(value);
}

function formatCost(value: number | null): string {
  if (typeof value !== 'number') return '-';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function formatPeriod(period: MaasUsageSummary['period']): string {
  if (!period) return '-';
  return `${formatDate(period.startingAt)} - ${formatDate(period.endingAt)}`;
}

function totalTokens(summary: MaasUsageSummary | null): number | null {
  if (!summary) return null;
  if (summary.totalInputTokens === null && summary.totalOutputTokens === null) return null;
  return (summary.totalInputTokens ?? 0) + (summary.totalOutputTokens ?? 0);
}

export const AgentTabAccount: React.FC<AgentTabAccountProps> = observer(function AgentTabAccount({
  agentId,
}) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const provider = getRuntime(agentId);
  const profile = getRuntimeAccountProfile(agentId);
  const {
    value: providerConfig,
    isLoading: providerSettingsLoading,
    isSaving: providerSettingsSaving,
    update: updateProviderSettings,
  } = useRuntimeSettings(agentId);
  const maasConnections = useMaasConnections();
  const runtimeAccountStatus = useQuery<RuntimeAccountStatus>({
    queryKey: ['runtimeSettings', agentId, 'runtimeAccountStatus'] as const,
    queryFn: () =>
      rpc.runtimeSettings.getRuntimeAccountStatus(agentId) as Promise<RuntimeAccountStatus>,
    staleTime: 30_000,
  });
  const subscriptionAccount = useQuery<AgentSubscriptionAccount>({
    queryKey: ['runtimeSettings', agentId, 'subscriptionAccount'] as const,
    queryFn: () =>
      rpc.runtimeSettings.getSubscriptionAccount(agentId) as Promise<AgentSubscriptionAccount>,
    enabled: profile.officialSubscription.supported,
    staleTime: 30_000,
  });
  const probeRuntime = useMutation({
    mutationFn: () => rpc.dependencies.probe(agentId),
  });
  const probeApi = useMutation({
    mutationFn: () => rpc.runtimeSettings.probeOfficialApi(agentId),
  });
  const checkMaas = useCheckMaasConnection();

  const expandedStorageKey = `yoda:agent-account:expanded:${agentId}`;
  const [expandedId, setExpandedId] = useState<AgentAccountProviderId | null>(() => {
    const stored = localStorage.getItem(expandedStorageKey);
    return stored && (AGENT_ACCOUNT_PROVIDER_IDS as readonly string[]).includes(stored)
      ? (stored as AgentAccountProviderId)
      : null;
  });
  const toggleExpanded = useCallback(
    (id: AgentAccountProviderId) => {
      setExpandedId((current) => {
        const next = current === id ? null : id;
        if (next) localStorage.setItem(expandedStorageKey, next);
        else localStorage.removeItem(expandedStorageKey);
        return next;
      });
    },
    [expandedStorageKey]
  );

  // Local usage is a heavy disk scan — only load it once a panel that shows
  // it is open; manual refresh bypasses the main-process TTL cache.
  const [localUsageRefresh, setLocalUsageRefresh] = useState(0);
  const localUsage = useQuery<AgentLocalUsage>({
    queryKey: ['runtimeSettings', agentId, 'localUsage', localUsageRefresh] as const,
    queryFn: () =>
      rpc.runtimeSettings.getLocalUsage(agentId, {
        forceRefresh: localUsageRefresh > 0,
      }) as Promise<AgentLocalUsage>,
    enabled: expandedId === 'official-subscription' || expandedId === 'official-api',
    staleTime: 5 * 60_000,
  });

  const connectedMaasConnections = useMemo(
    () => maasConnections.data?.filter((connection) => connection.connected) ?? [],
    [maasConnections.data]
  );
  const zenmuxConnection = findConnection(maasConnections.data, 'zenmux');
  const usageSummary = useMaasUsageSummary('zenmux', 'all', zenmuxConnection.connected, {
    providerHints: profile.maas.providerHints,
    modelHints: profile.maas.modelHints,
  });
  const handleSelectAuthProvider = useCallback(
    (authProvider: AgentAccountProviderId) => {
      updateProviderSettings({ ...(providerConfig ?? {}), authProvider });
    },
    [providerConfig, updateProviderSettings]
  );
  const handleSaveEnvVar = useCallback(
    (key: string, value: string | null) => {
      const env = { ...(providerConfig?.env ?? {}) };
      const trimmed = value?.trim() ?? '';
      if (trimmed) {
        env[key] = trimmed;
      } else {
        delete env[key];
      }
      updateProviderSettings({ ...(providerConfig ?? {}), env });
    },
    [providerConfig, updateProviderSettings]
  );

  if (!provider) return null;

  const dep = appState.dependencies.agentStatuses[provider.id];
  const runtimeDetected = dep?.status === 'available';
  const knownEnvVars = runtimeAccountStatus.data?.officialApiEnvVars ?? [
    ...profile.officialApi.envVars,
  ];
  const configuredApiCount = runtimeAccountStatus.data?.configuredApiEnvVars.length ?? 0;
  const authProviderAvailability: Record<AgentAccountProviderId, boolean> = {
    'official-subscription': profile.officialSubscription.supported && runtimeDetected,
    'official-api': configuredApiCount > 0,
    'yoda-maas': profile.maas.supported && connectedMaasConnections.length > 0,
  };
  const selectedAuthProvider =
    providerConfig?.authProvider ?? resolveDefaultAuthProvider(authProviderAvailability);
  const authBusy = providerSettingsLoading || providerSettingsSaving;

  const account = subscriptionAccount.data;
  const subscriptionStatusLabel = !runtimeDetected
    ? t('agents.account.statusRuntimeMissing')
    : account?.loggedIn && account.email
      ? account.email
      : account?.supported
        ? t('agents.account.statusLoggedOut')
        : dep?.version
          ? t('agents.account.statusRuntimeVersion', { version: dep.version })
          : t('agents.account.statusRuntimeDetected');
  const subscriptionReady = runtimeDetected && (!account?.supported || account.loggedIn);
  const recheckPending = probeRuntime.isPending || subscriptionAccount.isFetching;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-6">
      <AgentSection
        title={t('agents.account.title')}
        description={t('agents.account.description', { name: provider.name })}
      >
        <RadioGroup
          className="gap-0"
          value={selectedAuthProvider}
          disabled={authBusy}
          onValueChange={(value) => {
            if (value) handleSelectAuthProvider(value as AgentAccountProviderId);
          }}
        >
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            <AuthSourceRow
              id="official-subscription"
              title={t('agents.account.officialSubscription')}
              description={t('agents.account.officialSubscriptionDescription', {
                name: provider.name,
              })}
              available={authProviderAvailability['official-subscription']}
              selected={selectedAuthProvider === 'official-subscription'}
              statusReady={subscriptionReady}
              statusLabel={subscriptionStatusLabel}
              expanded={expandedId === 'official-subscription'}
              onToggle={toggleExpanded}
              actions={
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={recheckPending}
                    onClick={() => {
                      probeRuntime.mutate();
                      void subscriptionAccount.refetch();
                    }}
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', recheckPending && 'animate-spin')} />
                    {t('agents.account.recheckRuntime')}
                  </Button>
                  {provider.docUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void rpc.app.openExternal(provider.docUrl!)}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {t('agents.docs')}
                    </Button>
                  )}
                </>
              }
            >
              <div className="space-y-3">
                <SubscriptionAccountPanel
                  account={account ?? null}
                  loading={subscriptionAccount.isLoading}
                  runtimeDetected={runtimeDetected}
                  runtimeVersion={dep?.version ?? null}
                  runtimeName={provider.name}
                />
                <LocalUsagePanel
                  usage={localUsage.data ?? null}
                  loading={localUsage.isLoading}
                  queryError={localUsage.error ? String(localUsage.error) : null}
                  refreshing={localUsage.isFetching && !localUsage.isLoading}
                  onRefresh={() => setLocalUsageRefresh((value) => value + 1)}
                />
              </div>
            </AuthSourceRow>

            <AuthSourceRow
              id="official-api"
              title={t('agents.account.officialApi')}
              description={t('agents.account.officialApiDescription', { name: provider.name })}
              available={authProviderAvailability['official-api']}
              selected={selectedAuthProvider === 'official-api'}
              statusReady={configuredApiCount > 0}
              statusLabel={
                knownEnvVars.length === 0
                  ? t('agents.account.statusApiUnknown')
                  : configuredApiCount > 0
                    ? t('agents.account.statusApiConfigured', {
                        count: configuredApiCount,
                        total: knownEnvVars.length,
                      })
                    : t('agents.account.statusApiMissing')
              }
              expanded={expandedId === 'official-api'}
              onToggle={toggleExpanded}
              actions={
                profile.officialApi.probe ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={configuredApiCount === 0 || probeApi.isPending}
                    onClick={() => probeApi.mutate()}
                  >
                    <RefreshCw
                      className={cn('h-3.5 w-3.5', probeApi.isPending && 'animate-spin')}
                    />
                    {t('agents.account.testConnection')}
                  </Button>
                ) : undefined
              }
              footer={<ConnectionCheckResult result={probeApi.data ?? null} />}
            >
              <div className="space-y-3">
                <EnvVarEditor
                  envVars={knownEnvVars}
                  envValues={providerConfig?.env ?? {}}
                  inheritedEnvVars={runtimeAccountStatus.data?.inheritedApiEnvVars ?? []}
                  loading={runtimeAccountStatus.isLoading}
                  saving={providerSettingsSaving}
                  onSave={handleSaveEnvVar}
                />
                <LocalUsagePanel
                  usage={localUsage.data ?? null}
                  loading={localUsage.isLoading}
                  queryError={localUsage.error ? String(localUsage.error) : null}
                  refreshing={localUsage.isFetching && !localUsage.isLoading}
                  onRefresh={() => setLocalUsageRefresh((value) => value + 1)}
                />
              </div>
            </AuthSourceRow>

            <AuthSourceRow
              id="yoda-maas"
              title={t('agents.account.maasSource')}
              description={t('agents.account.maasDescription')}
              available={authProviderAvailability['yoda-maas']}
              selected={selectedAuthProvider === 'yoda-maas'}
              statusReady={connectedMaasConnections.length > 0}
              statusLabel={
                connectedMaasConnections.length > 0
                  ? t('agents.account.statusMaasConfigured', {
                      count: connectedMaasConnections.length,
                    })
                  : t('agents.account.statusMaasMissing')
              }
              expanded={expandedId === 'yoda-maas'}
              onToggle={toggleExpanded}
              actions={
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!zenmuxConnection.connected || checkMaas.isPending}
                    onClick={() => checkMaas.mutate('zenmux')}
                  >
                    <RefreshCw
                      className={cn('h-3.5 w-3.5', checkMaas.isPending && 'animate-spin')}
                    />
                    {t('agents.account.testConnection')}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => navigate('maas')}>
                    {t('agents.account.manageMaas')}
                  </Button>
                </>
              }
              footer={<ConnectionCheckResult result={checkMaas.data ?? null} />}
            >
              <div className="space-y-3">
                <MaasConnectionList connections={connectedMaasConnections} />
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {t('agents.account.usageTitle')}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      disabled={!zenmuxConnection.connected || usageSummary.reloading}
                      aria-label={t('agents.account.usageRefresh')}
                      onClick={usageSummary.reload}
                    >
                      <RefreshCw className={cn(usageSummary.reloading && 'animate-spin')} />
                    </Button>
                  </div>
                  <UsageSummaryPanel
                    connected={zenmuxConnection.connected}
                    loading={usageSummary.loading}
                    error={usageSummary.error}
                    summary={usageSummary.summary}
                    providerHints={profile.maas.providerHints}
                  />
                </div>
              </div>
            </AuthSourceRow>
          </div>
        </RadioGroup>
      </AgentSection>
    </div>
  );
});

const AuthSourceRow: React.FC<{
  id: AgentAccountProviderId;
  title: string;
  description: string;
  available: boolean;
  selected: boolean;
  statusReady: boolean;
  statusLabel: string;
  expanded: boolean;
  onToggle: (id: AgentAccountProviderId) => void;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
}> = ({
  id,
  title,
  description,
  available,
  selected,
  statusReady,
  statusLabel,
  expanded,
  onToggle,
  actions,
  footer,
  children,
}) => {
  const { t } = useTranslation();

  return (
    <div>
      <div
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3"
        onClick={() => onToggle(id)}
      >
        <RadioGroupItem
          value={id}
          disabled={!available}
          aria-label={t('agents.account.selectAria', { name: title })}
          onClick={(event) => event.stopPropagation()}
        />
        <div className="min-w-0">
          {/* truncate (not wrap) keeps the short label on one line; the long
              status text beside it is what gives way on narrow widths. */}
          <span className="block truncate text-sm font-medium">{title}</span>
          {selected && !available && (
            <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
              {t('agents.account.selectedUnavailable')}
            </p>
          )}
        </div>
        <span
          className="ml-auto flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
          title={statusLabel}
        >
          <span
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              statusReady ? 'bg-emerald-500' : 'bg-muted-foreground/30'
            )}
          />
          <span className="truncate">{statusLabel}</span>
        </span>
        <button
          type="button"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background-secondary"
          aria-expanded={expanded}
          aria-label={t('agents.account.expandAria', { name: title })}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(id);
          }}
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} />
        </button>
      </div>
      {expanded && (
        <div className="px-4 pb-4 pl-11">
          <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
          {children && <div className="mt-3">{children}</div>}
          {actions && <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div>}
          {footer && <div className="mt-2">{footer}</div>}
        </div>
      )}
    </div>
  );
};

const SubscriptionAccountPanel: React.FC<{
  account: AgentSubscriptionAccount | null;
  loading: boolean;
  runtimeDetected: boolean;
  runtimeVersion: string | null;
  runtimeName: string;
}> = ({ account, loading, runtimeDetected, runtimeVersion, runtimeName }) => {
  const { t } = useTranslation();

  if (loading) {
    return (
      <p className="text-xs text-muted-foreground">{t('agents.account.loadingAccountStatus')}</p>
    );
  }

  const rows: { label: string; value: string }[] = [
    {
      label: t('agents.account.accountCli'),
      value: runtimeDetected
        ? runtimeVersion
          ? t('agents.account.statusRuntimeVersion', { version: runtimeVersion })
          : t('agents.account.statusRuntimeDetected')
        : t('agents.account.statusRuntimeMissing'),
    },
  ];

  if (account?.loggedIn) {
    if (account.email) {
      rows.push({
        label: t('agents.account.accountLabel'),
        value: account.displayName ? `${account.displayName} · ${account.email}` : account.email,
      });
    }
    if (account.organization) {
      rows.push({ label: t('agents.account.accountOrg'), value: account.organization });
    }
    if (account.plan) {
      rows.push({ label: t('agents.account.accountPlan'), value: account.plan });
    }
  }

  return (
    <div className="space-y-2">
      <div className="divide-y divide-border overflow-hidden rounded-md border border-border">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-3 bg-background px-3 py-2"
          >
            <span className="shrink-0 text-xs text-muted-foreground">{row.label}</span>
            <span className="min-w-0 truncate text-xs" title={row.value}>
              {row.value}
            </span>
          </div>
        ))}
      </div>
      {account?.error && (
        <p className="text-xs text-destructive">
          {t('agents.account.accountLoadFailed')}: {account.error}
        </p>
      )}
      {account && account.supported && !account.loggedIn && !account.error && (
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {t('agents.account.accountNotLoggedIn', { name: runtimeName })}
        </p>
      )}
      {account && !account.supported && (
        <p className="text-xs text-muted-foreground">
          {t('agents.account.accountUnsupported', { name: runtimeName })}
        </p>
      )}
    </div>
  );
};

const ConnectionCheckResult: React.FC<{ result: { ok: boolean; error: string | null } | null }> = ({
  result,
}) => {
  const { t } = useTranslation();

  if (!result) return null;

  if (result.ok) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {t('agents.account.testOk')}
      </p>
    );
  }

  return (
    <p className="flex items-start gap-1.5 text-xs text-destructive">
      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        {t('agents.account.testFailed')}
        {result.error ? `: ${result.error}` : ''}
      </span>
    </p>
  );
};

function maskSecret(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}••••${value.slice(-4)}` : '••••••';
}

/** Key-like env vars get masked display and password inputs; URLs etc. stay readable. */
function isSensitiveEnvVar(name: string): boolean {
  return /KEY|TOKEN|SECRET|AUTH|CREDENTIAL/i.test(name);
}

const EnvVarEditor: React.FC<{
  envVars: string[];
  envValues: Record<string, string>;
  inheritedEnvVars: string[];
  loading: boolean;
  saving: boolean;
  onSave: (key: string, value: string | null) => void;
}> = ({ envVars, envValues, inheritedEnvVars, loading, saving, onSave }) => {
  const { t } = useTranslation();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  if (loading) {
    return (
      <p className="text-xs text-muted-foreground">{t('agents.account.loadingAccountStatus')}</p>
    );
  }

  if (envVars.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        {t('agents.account.noKnownApiEnvVars')}
      </p>
    );
  }

  const startEditing = (key: string) => {
    setEditingKey(key);
    setDraft(envValues[key] ?? '');
  };
  const stopEditing = () => {
    setEditingKey(null);
    setDraft('');
  };
  const commit = (key: string) => {
    onSave(key, draft);
    stopEditing();
  };

  return (
    <div className="divide-y divide-border overflow-hidden rounded-md border border-border">
      {envVars.map((envVar) => {
        const customValue = envValues[envVar]?.trim() ? envValues[envVar] : null;
        const inherited = inheritedEnvVars.includes(envVar);
        const editing = editingKey === envVar;
        const sensitive = isSensitiveEnvVar(envVar);

        return (
          <div key={envVar} className="bg-background px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <code className="min-w-0 shrink truncate font-mono text-xs" title={envVar}>
                {envVar}
              </code>
              {editing ? (
                <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1.5">
                  <Input
                    autoFocus
                    type={sensitive ? 'password' : 'text'}
                    value={draft}
                    placeholder={t('agents.account.envValuePlaceholder')}
                    className="h-7 max-w-64 text-xs"
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !isImeComposing(event)) commit(envVar);
                      if (event.key === 'Escape') stopEditing();
                    }}
                  />
                  <Button
                    type="button"
                    variant="default"
                    size="xs"
                    disabled={saving || !draft.trim()}
                    onClick={() => commit(envVar)}
                  >
                    {t('agents.account.envSave')}
                  </Button>
                  <Button type="button" variant="ghost" size="xs" onClick={stopEditing}>
                    {t('agents.account.envCancel')}
                  </Button>
                </div>
              ) : (
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  {customValue ? (
                    <>
                      <span
                        className="max-w-48 truncate font-mono text-xs text-muted-foreground"
                        title={sensitive ? undefined : customValue}
                      >
                        {sensitive ? maskSecret(customValue) : customValue}
                      </span>
                      <span className="text-xs text-foreground">
                        {t('agents.account.envSourceCustom')}
                      </span>
                    </>
                  ) : (
                    <span
                      className={cn(
                        'text-xs',
                        inherited ? 'text-foreground' : 'text-muted-foreground'
                      )}
                    >
                      {inherited
                        ? t('agents.account.envSourceInherited')
                        : t('agents.account.envSourceUnset')}
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={saving}
                    onClick={() => startEditing(envVar)}
                  >
                    {customValue
                      ? t('agents.account.envEdit')
                      : inherited
                        ? t('agents.account.envOverride')
                        : t('agents.account.envSet')}
                  </Button>
                  {customValue && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled={saving}
                      onClick={() => onSave(envVar, null)}
                    >
                      {t('agents.account.envClear')}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const LocalUsagePanel: React.FC<{
  usage: AgentLocalUsage | null;
  loading: boolean;
  queryError: string | null;
  refreshing: boolean;
  onRefresh: () => void;
}> = ({ usage, loading, queryError, refreshing, onRefresh }) => {
  const { t } = useTranslation();

  if (loading) {
    return <p className="text-xs text-muted-foreground">{t('agents.account.localUsageLoading')}</p>;
  }

  const error = queryError ?? usage?.error ?? null;
  if (error) {
    return (
      <p className="text-xs text-destructive">
        {t('agents.account.localUsageError')}: {error}
      </p>
    );
  }

  if (!usage || !usage.supported) return null;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {t('agents.account.localUsageTitle')}
          {' · '}
          {t('agents.account.localUsageMeta', {
            days: usage.days,
            count: usage.sessionCount,
          })}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={refreshing}
          aria-label={t('agents.account.usageRefresh')}
          onClick={onRefresh}
        >
          <RefreshCw className={cn(refreshing && 'animate-spin')} />
        </Button>
      </div>
      {/* auto-fit so the 5 metrics reflow into rows instead of crushing into
          one row; gap-px over bg-border draws clean dividers in both axes. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-px overflow-hidden rounded-md border border-border bg-border">
        <UsageMetric
          label={t('agents.account.localUsageCost')}
          value={`≈ ${formatCost(usage.costUsd)}`}
        />
        <UsageMetric
          label={t('agents.account.localUsageInput')}
          value={formatCompactNumber(usage.inputTokens)}
        />
        <UsageMetric
          label={t('agents.account.localUsageOutput')}
          value={formatCompactNumber(usage.outputTokens)}
        />
        <UsageMetric
          label={t('agents.account.localUsageCacheRead')}
          value={formatCompactNumber(usage.cacheReadTokens)}
        />
        <UsageMetric
          label={t('agents.account.localUsageCacheWrite')}
          value={formatCompactNumber(usage.cacheCreationTokens)}
        />
      </div>
      {usage.unpricedModels.length > 0 && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t('agents.account.localUsageUnpriced', { models: usage.unpricedModels.join(', ') })}
        </p>
      )}
    </div>
  );
};

const MaasConnectionList: React.FC<{ connections: MaasConnection[] }> = ({ connections }) => {
  const { t } = useTranslation();

  if (connections.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        {t('agents.account.noMaasConnections')}
      </p>
    );
  }

  return (
    <div className="divide-y divide-border overflow-hidden rounded-md border border-border">
      {connections.map((connection) => (
        <div
          key={connection.platformId}
          className="flex min-w-0 items-center justify-between gap-3 bg-background px-3 py-2"
        >
          <span className="min-w-0 truncate text-xs font-medium" title={connection.displayName}>
            {connection.displayName}
          </span>
          <code
            className="min-w-0 truncate font-mono text-xs text-muted-foreground"
            title={connection.endpoint}
          >
            {connection.endpoint}
          </code>
        </div>
      ))}
    </div>
  );
};

const UsageSummaryPanel: React.FC<{
  connected: boolean;
  loading: boolean;
  error: string | null;
  summary: MaasUsageSummary | null;
  providerHints: readonly string[];
}> = ({ connected, loading, error, summary, providerHints }) => {
  const { t } = useTranslation();

  if (!connected) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-5 text-center text-xs leading-relaxed text-muted-foreground">
        {t('agents.account.usageNoMaas')}
      </p>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-md border border-border px-3 py-8 text-xs text-muted-foreground">
        <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
        {t('agents.account.usageLoading')}
      </div>
    );
  }

  if (error) {
    return (
      <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-3 text-xs text-destructive">
        {t('agents.account.usageError')}: {error}
      </p>
    );
  }

  if (!summary || summary.recordCount === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
        {t('agents.account.usageEmpty')}
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-px bg-border">
        <UsageMetric
          label={t('agents.account.usageTokens')}
          value={formatCompactNumber(totalTokens(summary))}
        />
        <UsageMetric
          label={t('agents.account.usageCost')}
          value={formatCost(summary.totalCostUsd)}
        />
        <UsageMetric
          label={t('agents.account.usageRecords')}
          value={`${formatCompactNumber(summary.recordCount)} / ${formatCompactNumber(
            summary.totalRecords
          )}`}
        />
      </div>
      <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
        {t('agents.account.usagePeriod')} {formatPeriod(summary.period)}
        {' · '}
        {providerHints.length > 0
          ? `${t('agents.account.usageFilteredBy')}: ${providerHints.join(', ')}`
          : t('agents.account.usageAllRoutes')}
      </div>
    </div>
  );
};

const UsageMetric: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  return (
    <div className="min-w-0 bg-background px-3 py-2">
      <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 truncate font-mono text-sm font-medium">{value}</div>
    </div>
  );
};
