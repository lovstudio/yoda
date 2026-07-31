import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MAX_CUSTOM_MODELS_PER_PROVIDER,
  MODEL_PROVIDER_DEFINITIONS,
  normalizeModelIdForProvider,
  type ModelProviderCatalogGroup,
  type ModelProviderCatalogResult,
} from '@shared/model-provider-catalog';
import { rpc } from '@renderer/lib/ipc';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { isImeComposing } from '@renderer/utils/ime';
import { cn } from '@renderer/utils/utils';
import { SettingRow } from './SettingRow';

const MODEL_PROVIDERS_QUERY_KEY = ['llm', 'modelProviders'] as const;

type UpdateCustomModelsInput = {
  providerId: string;
  customModels: string[];
};

export default function ModelsSettingsCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [providerId, setProviderId] = useState('openai');
  const [customModelDraft, setCustomModelDraft] = useState('');
  const [customModelError, setCustomModelError] = useState<string | null>(null);

  const catalogQuery = useQuery<ModelProviderCatalogResult>({
    queryKey: MODEL_PROVIDERS_QUERY_KEY,
    queryFn: () => rpc.llm.listModelProviders({ forceRefresh: false }),
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

  const refreshCatalog = useMutation<ModelProviderCatalogResult, Error, void>({
    mutationFn: () => rpc.llm.listModelProviders({ forceRefresh: true }),
    onSuccess: (result) => {
      queryClient.setQueryData(MODEL_PROVIDERS_QUERY_KEY, result);
      void queryClient.invalidateQueries({ queryKey: ['llm', 'modelDiscovery'] });
    },
  });

  const disabled =
    catalogQuery.isLoading || updateCustomModels.isPending || refreshCatalog.isPending;

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
              setProviderId(value);
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
            </SelectContent>
          </Select>
        }
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={catalogQuery.data?.error ? 'destructive' : 'secondary'}>
            {catalogQuery.data?.error
              ? t('settings.models.statusFailed')
              : t('settings.models.statusReady')}
          </Badge>
          <span>
            {t('settings.models.modelCount', {
              provider: selectedProvider?.name ?? selectedProviderId,
              count: selectedProvider?.models.length ?? 0,
            })}
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => refreshCatalog.mutate()}
          disabled={disabled}
          className="gap-1.5"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshCatalog.isPending && 'animate-spin')} />
          {refreshCatalog.isPending
            ? t('settings.models.refreshing')
            : t('settings.models.refresh')}
        </Button>
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
    models: [],
    customModels: [],
  }));
}

function isValidModelId(value: string): boolean {
  return value.length >= 2 && value.length <= 100 && /^[a-z0-9][a-z0-9._:/+-]*$/i.test(value);
}
