import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plus, RefreshCw, Trash2 } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isReservedModelProviderId,
  MAX_CUSTOM_MODEL_PROVIDERS,
  MAX_CUSTOM_MODELS_PER_PROVIDER,
  MODEL_PROVIDER_DEFINITIONS,
  normalizeCustomModelProviderId,
  normalizeModelIdForProvider,
  type CreateCustomModelProviderInput,
  type ModelProviderCatalogGroup,
  type ModelProviderCatalogResult,
} from '@shared/model-provider-catalog';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Switch } from '@renderer/lib/ui/switch';
import { isImeComposing } from '@renderer/utils/ime';
import { cn } from '@renderer/utils/utils';
import { SettingRow } from './SettingRow';

const MODEL_PROVIDERS_QUERY_KEY = ['llm', 'modelProviders'] as const;
const ADD_CUSTOM_PROVIDER_ACTION = '__add_custom_provider__';

type UpdateCustomModelsInput = {
  providerId: string;
  customModels: string[];
};

export default function ModelsSettingsCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const showConfirm = useShowModal('confirmActionModal');
  const [providerId, setProviderId] = useState('openai');
  const [customModelDraft, setCustomModelDraft] = useState('');
  const [customModelError, setCustomModelError] = useState<string | null>(null);
  const [showProviderCreator, setShowProviderCreator] = useState(false);
  const [providerNameDraft, setProviderNameDraft] = useState('');
  const [providerIdDraft, setProviderIdDraft] = useState('');
  const [providerIdEdited, setProviderIdEdited] = useState(false);
  const [initialModelDraft, setInitialModelDraft] = useState('');
  const [providerFormError, setProviderFormError] = useState<string | null>(null);

  const catalogQuery = useQuery<ModelProviderCatalogResult>({
    queryKey: MODEL_PROVIDERS_QUERY_KEY,
    queryFn: () => rpc.llm.listModelProviders(),
    staleTime: 60_000,
  });

  const providers = useMemo(
    () => catalogQuery.data?.providers ?? fallbackProviderGroups(),
    [catalogQuery.data]
  );
  const selectedProvider = providers.find((provider) => provider.id === providerId) ?? providers[0];
  const selectedProviderId = selectedProvider?.id ?? providerId;
  const customModels = selectedProvider?.customModels ?? [];

  const updateCustomModels = useMutation<
    ModelProviderCatalogResult,
    Error,
    UpdateCustomModelsInput
  >({
    mutationFn: ({ providerId: id, customModels: models }) =>
      rpc.llm.updateModelProviderCustomModels(id, models),
    onSuccess: (result) => {
      queryClient.setQueryData(MODEL_PROVIDERS_QUERY_KEY, result);
      void queryClient.invalidateQueries({ queryKey: ['llm', 'modelDiscovery'] });
    },
  });

  const refreshCatalog = useMutation<ModelProviderCatalogResult, Error, string>({
    mutationFn: (id) => rpc.llm.refreshModelProviders(id),
    onSuccess: (result) => {
      queryClient.setQueryData(MODEL_PROVIDERS_QUERY_KEY, result);
      void queryClient.invalidateQueries({ queryKey: ['llm', 'modelDiscovery'] });
    },
  });

  const updateAutomaticUpdates = useMutation<ModelProviderCatalogResult, Error, boolean>({
    mutationFn: (enabled) => rpc.llm.setModelProviderAutomaticUpdates(enabled),
    onSuccess: (result) => {
      queryClient.setQueryData(MODEL_PROVIDERS_QUERY_KEY, result);
    },
  });

  const createCustomProvider = useMutation<
    ModelProviderCatalogResult,
    Error,
    CreateCustomModelProviderInput
  >({
    mutationFn: (input) => rpc.llm.createCustomModelProvider(input),
    onSuccess: (result, input) => {
      queryClient.setQueryData(MODEL_PROVIDERS_QUERY_KEY, result);
      void queryClient.invalidateQueries({ queryKey: ['llm', 'modelDiscovery'] });
      setProviderId(input.id);
      resetProviderCreator();
    },
  });

  const deleteCustomProvider = useMutation<ModelProviderCatalogResult, Error, string>({
    mutationFn: (id) => rpc.llm.deleteCustomModelProvider(id),
    onSuccess: (result) => {
      queryClient.setQueryData(MODEL_PROVIDERS_QUERY_KEY, result);
      void queryClient.invalidateQueries({ queryKey: ['llm', 'modelDiscovery'] });
      setProviderId(result.providers[0]?.id ?? 'openai');
      setCustomModelDraft('');
      setCustomModelError(null);
    },
  });

  const disabled =
    catalogQuery.isLoading ||
    updateCustomModels.isPending ||
    refreshCatalog.isPending ||
    updateAutomaticUpdates.isPending ||
    createCustomProvider.isPending ||
    deleteCustomProvider.isPending;

  function resetProviderCreator() {
    setShowProviderCreator(false);
    setProviderNameDraft('');
    setProviderIdDraft('');
    setProviderIdEdited(false);
    setInitialModelDraft('');
    setProviderFormError(null);
  }

  const submitCustomProvider = () => {
    const name = providerNameDraft.trim();
    const id = normalizeCustomModelProviderId(providerIdDraft);
    if (!name || name.length > 60) {
      setProviderFormError(t('settings.models.providerNameInvalid'));
      return;
    }
    if (!id || isReservedModelProviderId(id)) {
      setProviderFormError(t('settings.models.providerIdInvalid'));
      return;
    }
    if (providers.some((provider) => provider.id === id)) {
      setProviderFormError(t('settings.models.providerDuplicate'));
      return;
    }
    if (providers.filter((provider) => provider.custom).length >= MAX_CUSTOM_MODEL_PROVIDERS) {
      setProviderFormError(
        t('settings.models.providerLimit', { count: MAX_CUSTOM_MODEL_PROVIDERS })
      );
      return;
    }
    const initialModel = initialModelDraft.trim();
    if (initialModel) {
      const normalizedModel = normalizeModelIdForProvider(id, initialModel);
      if (!normalizedModel || !isValidModelId(normalizedModel)) {
        setProviderFormError(t('settings.models.providerInitialModelInvalid'));
        return;
      }
    }

    setProviderFormError(null);
    createCustomProvider.mutate({
      id,
      name,
      ...(initialModel ? { initialModel } : {}),
    });
  };

  const requestDeleteCustomProvider = (provider: ModelProviderCatalogGroup) => {
    showConfirm({
      title: t('settings.models.deleteProviderTitle'),
      description: t('settings.models.deleteProviderDescription', { provider: provider.name }),
      confirmLabel: t('settings.models.deleteProviderConfirm'),
      onSuccess: () => deleteCustomProvider.mutate(provider.id),
    });
  };

  const addCustomModel = () => {
    const modelId = normalizeModelIdForProvider(selectedProviderId, customModelDraft);
    if (!modelId || !isValidModelId(modelId)) {
      setCustomModelError(t('settings.models.customInvalid'));
      return;
    }
    if (customModels.includes(modelId)) {
      setCustomModelError(t('settings.models.customDuplicate'));
      return;
    }
    if (customModels.length >= MAX_CUSTOM_MODELS_PER_PROVIDER) {
      setCustomModelError(
        t('settings.models.customLimit', { count: MAX_CUSTOM_MODELS_PER_PROVIDER })
      );
      return;
    }

    setCustomModelError(null);
    updateCustomModels.mutate(
      {
        providerId: selectedProviderId,
        customModels: [...customModels, modelId],
      },
      {
        onSuccess: () => setCustomModelDraft(''),
      }
    );
  };

  const removeCustomModel = (modelId: string) => {
    setCustomModelError(null);
    updateCustomModels.mutate({
      providerId: selectedProviderId,
      customModels: customModels.filter((model) => model !== modelId),
    });
  };

  return (
    <div className="@container flex min-w-0 flex-col gap-5" data-testid="models-settings-card">
      <SettingRow
        title={t('settings.models.provider')}
        description={t('settings.models.providerDescription')}
        control={
          <Select
            value={selectedProviderId}
            onValueChange={(value) => {
              if (!value) return;
              if (value === ADD_CUSTOM_PROVIDER_ACTION) {
                setShowProviderCreator(true);
                return;
              }
              setProviderId(value);
              resetProviderCreator();
              setCustomModelDraft('');
              setCustomModelError(null);
            }}
          >
            <SelectTrigger
              className="w-52 max-w-[55cqw]"
              aria-label={t('settings.models.provider')}
            >
              <SelectValue>
                {() => selectedProvider?.name ?? t('settings.models.providerUnknown')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="end" className="max-h-80">
              {providers.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.name}
                </SelectItem>
              ))}
              <SelectSeparator />
              <SelectItem value={ADD_CUSTOM_PROVIDER_ACTION}>
                <Plus className="h-3.5 w-3.5" />
                {t('settings.models.addProvider')}
              </SelectItem>
            </SelectContent>
          </Select>
        }
      />

      {showProviderCreator && (
        <div className="rounded-md border border-border bg-background-secondary/40 p-3">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{t('settings.models.customProviderTitle')}</div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t('settings.models.customProviderDescription')}
              </p>
            </div>
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <div className="grid gap-3 @2xl:grid-cols-2">
              <Label className="min-w-0 flex-col items-stretch gap-1.5 leading-normal">
                <span>{t('settings.models.providerName')}</span>
                <Input
                  value={providerNameDraft}
                  onChange={(event) => {
                    const value = event.target.value;
                    setProviderNameDraft(value);
                    if (!providerIdEdited) setProviderIdDraft(suggestProviderId(value));
                    setProviderFormError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !isImeComposing(event)) {
                      event.preventDefault();
                      submitCustomProvider();
                    }
                  }}
                  aria-label={t('settings.models.providerName')}
                  placeholder={t('settings.models.providerNamePlaceholder')}
                  disabled={disabled}
                />
              </Label>
              <Label className="min-w-0 flex-col items-stretch gap-1.5 leading-normal">
                <span>{t('settings.models.providerId')}</span>
                <Input
                  value={providerIdDraft}
                  onChange={(event) => {
                    setProviderIdDraft(event.target.value.toLowerCase());
                    setProviderIdEdited(true);
                    setProviderFormError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !isImeComposing(event)) {
                      event.preventDefault();
                      submitCustomProvider();
                    }
                  }}
                  aria-label={t('settings.models.providerId')}
                  placeholder={t('settings.models.providerIdPlaceholder')}
                  disabled={disabled}
                  className="font-mono text-xs"
                />
              </Label>
              <Label className="min-w-0 flex-col items-stretch gap-1.5 leading-normal @2xl:col-span-2">
                <span>{t('settings.models.providerInitialModel')}</span>
                <Input
                  value={initialModelDraft}
                  onChange={(event) => {
                    setInitialModelDraft(event.target.value);
                    setProviderFormError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !isImeComposing(event)) {
                      event.preventDefault();
                      submitCustomProvider();
                    }
                  }}
                  aria-label={t('settings.models.providerInitialModel')}
                  placeholder={t('settings.models.providerInitialModelPlaceholder')}
                  disabled={disabled}
                  className="font-mono text-xs"
                />
              </Label>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {t('settings.models.providerIdDescription')}
            </p>
            {(providerFormError || createCustomProvider.isError) && (
              <p className="mt-2 text-xs text-destructive" role="alert">
                {providerFormError ?? t('settings.models.providerSaveFailed')}
              </p>
            )}
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={resetProviderCreator}
                disabled={disabled}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={submitCustomProvider}
                disabled={disabled || !providerNameDraft.trim() || !providerIdDraft.trim()}
                className="gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                {t('settings.models.createProvider')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <SettingRow
        title={t('settings.models.automaticUpdates')}
        description={t('settings.models.automaticUpdatesDescription')}
        control={
          <Switch
            checked={catalogQuery.data?.automaticUpdatesEnabled ?? true}
            onCheckedChange={(checked) => updateAutomaticUpdates.mutate(checked)}
            disabled={disabled}
            aria-label={t('settings.models.automaticUpdates')}
          />
        }
      />

      <ProviderCatalogStatus
        provider={selectedProvider}
        isRefreshing={refreshCatalog.isPending}
        disabled={disabled}
        onRefresh={() => refreshCatalog.mutate(selectedProviderId)}
        onDelete={() => {
          if (selectedProvider) requestDeleteCustomProvider(selectedProvider);
        }}
      />

      <div className="border-t border-border pt-5">
        <div className="rounded-md border border-border bg-background-secondary/40 p-3">
          <div className="text-sm font-medium">{t('settings.models.customTitle')}</div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t('settings.models.customDescription', {
              provider: selectedProvider?.name ?? selectedProviderId,
              count: MAX_CUSTOM_MODELS_PER_PROVIDER,
            })}
          </p>
          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
            <Input
              value={customModelDraft}
              onChange={(event) => {
                setCustomModelDraft(event.target.value);
                setCustomModelError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !isImeComposing(event)) {
                  event.preventDefault();
                  addCustomModel();
                }
              }}
              aria-label={t('settings.models.customInput')}
              placeholder={t('settings.models.customPlaceholder')}
              disabled={disabled}
              className="min-w-48 flex-1 font-mono text-xs"
            />
            <Button
              type="button"
              size="sm"
              onClick={addCustomModel}
              disabled={disabled || !customModelDraft.trim()}
              className="gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('settings.models.customAdd')}
            </Button>
          </div>
          {(customModelError || updateCustomModels.isError) && (
            <p className="mt-2 text-xs text-destructive" role="alert">
              {customModelError ?? t('settings.models.saveFailed')}
            </p>
          )}
        </div>
      </div>

      <ProviderModelList
        provider={selectedProvider}
        isLoading={catalogQuery.isLoading}
        disabled={disabled}
        onRemoveCustom={removeCustomModel}
      />
    </div>
  );
}

function ProviderCatalogStatus({
  provider,
  isRefreshing,
  disabled,
  onRefresh,
  onDelete,
}: {
  provider: ModelProviderCatalogGroup | undefined;
  isRefreshing: boolean;
  disabled: boolean;
  onRefresh: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  if (!provider) return null;

  const statusKey = `settings.models.updateStatus.${provider.updateStatus}`;
  const officialSourceUrl = provider.officialSourceUrl;
  const date =
    provider.officialFetchedAt ?? provider.officialSnapshotAt ?? provider.lastUpdateAttemptAt;
  const description = getProviderStatusDescription(provider, date, t);

  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-border bg-background-secondary/40 p-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={provider.updateStatus === 'stale' ? 'destructive' : 'secondary'}
              className="h-auto max-w-full break-all whitespace-normal"
            >
              {t(statusKey)}
            </Badge>
            <div className="min-w-0 w-full basis-full break-all text-xs text-muted-foreground">
              {t('settings.models.modelCount', {
                provider: provider.name,
                count: provider.models.length,
              })}
            </div>
          </div>
          <p className="mt-2 min-w-0 break-all text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
          {officialSourceUrl && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="mt-1 h-auto gap-1 p-0 text-xs"
              onClick={() => void rpc.app.openExternal(officialSourceUrl)}
            >
              {t('settings.models.officialSource')}
              <ExternalLink className="h-3 w-3" />
            </Button>
          )}
        </div>
        {provider.custom ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDelete}
            disabled={disabled}
            className="shrink-0 gap-1.5 text-destructive hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('settings.models.deleteProvider')}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={disabled}
            className="shrink-0 gap-1.5"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
            {isRefreshing ? t('settings.models.refreshing') : t('settings.models.refresh')}
          </Button>
        )}
      </div>
    </div>
  );
}

function getProviderStatusDescription(
  provider: ModelProviderCatalogGroup,
  date: string | null,
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (provider.custom) return t('settings.models.customProviderStatusDescription');
  if (provider.officialApiSupported) {
    if (provider.updateStatus === 'current') {
      return t('settings.models.officialApiUpdated', { date: formatCatalogDate(date) });
    }
    if (provider.updateStatus === 'stale') {
      return t('settings.models.officialApiStale', { date: formatCatalogDate(date) });
    }
    return provider.officialApiConfigured
      ? t('settings.models.officialSnapshotConfigured', {
          date: formatCatalogDate(date),
        })
      : t('settings.models.officialSnapshotNeedsKey', {
          date: formatCatalogDate(date),
        });
  }
  if (provider.officialSourceUrl) {
    return t('settings.models.officialSnapshotStatic', {
      date: formatCatalogDate(date),
    });
  }
  return provider.updateStatus === 'stale'
    ? t('settings.models.aggregateStaleDescription')
    : t('settings.models.aggregateOnlyDescription');
}

function ProviderModelList({
  provider,
  isLoading,
  disabled,
  onRemoveCustom,
}: {
  provider: ModelProviderCatalogGroup | undefined;
  isLoading: boolean;
  disabled: boolean;
  onRemoveCustom: (modelId: string) => void;
}) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="rounded-md border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
        {t('settings.models.loading')}
      </div>
    );
  }

  if (!provider || provider.models.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-3 py-8 text-center">
        <div className="text-sm font-medium">{t('settings.models.emptyTitle')}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {t('settings.models.emptyDescription', { provider: provider?.name ?? '' })}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      {provider.models.map((model) => (
        <div
          key={model.id}
          className="flex min-w-0 items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0"
        >
          <code className="min-w-0 flex-1 truncate font-mono text-xs">{model.id}</code>
          {model.sources.includes('official') && (
            <Badge variant="secondary">{t('settings.models.officialBadge')}</Badge>
          )}
          {model.sources.includes('aggregate') && !model.sources.includes('official') && (
            <Badge variant="outline">{t('settings.models.aggregateBadge')}</Badge>
          )}
          {model.custom && (
            <>
              <Badge variant="secondary">{t('settings.models.customBadge')}</Badge>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t('settings.models.removeCustom', { model: model.id })}
                title={t('settings.models.removeCustom', { model: model.id })}
                onClick={() => onRemoveCustom(model.id)}
                disabled={disabled}
                className="shrink-0 text-foreground-muted hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function fallbackProviderGroups(): ModelProviderCatalogGroup[] {
  return MODEL_PROVIDER_DEFINITIONS.map((provider) => ({
    id: provider.id,
    name: provider.name,
    custom: false,
    models: [],
    customModels: [],
    officialSourceUrl: null,
    officialSnapshotAt: null,
    officialFetchedAt: null,
    lastUpdateAttemptAt: null,
    officialApiSupported: false,
    officialApiConfigured: false,
    updateStatus: 'aggregateOnly',
  }));
}

function formatCatalogDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: value.includes('T00:00:00.000Z') ? undefined : 'short',
  }).format(date);
}

function isValidModelId(value: string): boolean {
  return value.length >= 2 && value.length <= 100 && /^[a-z0-9][a-z0-9._:/+-]*$/i.test(value);
}

function suggestProviderId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 60);
}
