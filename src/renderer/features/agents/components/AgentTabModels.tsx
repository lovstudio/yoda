import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EyeOff, Plus, RefreshCw, Trash2 } from 'lucide-react';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MAX_CUSTOM_RUNTIME_MODELS,
  type AgentModelCandidateInferenceResult,
  type AgentModelCandidateItem,
} from '@shared/runtime-model-candidates';
import type { RuntimeId } from '@shared/runtime-registry';
import { rpc } from '@renderer/lib/ipc';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { Input } from '@renderer/lib/ui/input';
import { isImeComposing } from '@renderer/utils/ime';
import { cn } from '@renderer/utils/utils';
import { AgentSection } from './AgentSection';

type PreferencesInput = {
  hiddenModels?: string[];
  customModels?: string[];
};

export const AgentTabModels: React.FC<{ agentId: RuntimeId; embedded?: boolean }> = ({
  agentId,
  embedded = false,
}) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [customModelDraft, setCustomModelDraft] = useState('');
  const [customModelError, setCustomModelError] = useState<string | null>(null);
  const modelQueryKey = useMemo(() => ['runtimeSettings', agentId, 'models'] as const, [agentId]);
  const invalidateModelConsumers = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ['runtimeSettings', agentId, 'namingModelCandidates'],
    });
    void queryClient.invalidateQueries({ queryKey: ['llm', 'modelDiscovery'] });
  }, [agentId, queryClient]);

  const modelQuery = useQuery<AgentModelCandidateInferenceResult>({
    queryKey: modelQueryKey,
    queryFn: () =>
      rpc.runtimeSettings.inferNamingModelCandidates(agentId, {
        forceRefresh: false,
      }) as Promise<AgentModelCandidateInferenceResult>,
    staleTime: 60_000,
  });

  const updatePreferences = useMutation<
    AgentModelCandidateInferenceResult,
    Error,
    PreferencesInput
  >({
    mutationFn: (input) =>
      rpc.runtimeSettings.updateModelCandidatePreferences(
        agentId,
        input
      ) as Promise<AgentModelCandidateInferenceResult>,
    onSuccess: (result) => {
      queryClient.setQueryData(modelQueryKey, result);
      void queryClient.invalidateQueries({ queryKey: ['runtimeSettings', agentId, 'meta'] });
      void queryClient.invalidateQueries({ queryKey: ['runtimeSettings', agentId] });
      invalidateModelConsumers();
    },
  });

  const refreshModels = useMutation<AgentModelCandidateInferenceResult, Error, void>({
    mutationFn: () =>
      rpc.runtimeSettings.inferNamingModelCandidates(agentId, {
        forceRefresh: true,
      }) as Promise<AgentModelCandidateInferenceResult>,
    onSuccess: (result) => {
      queryClient.setQueryData(modelQueryKey, result);
      invalidateModelConsumers();
    },
  });

  const hiddenModels = useMemo(() => modelQuery.data?.hiddenModels ?? [], [modelQuery.data]);
  const customModels = useMemo(() => modelQuery.data?.customModels ?? [], [modelQuery.data]);
  const models = useMemo(() => modelQuery.data?.models ?? [], [modelQuery.data]);
  const disabled = modelQuery.isLoading || updatePreferences.isPending || refreshModels.isPending;

  const setModelVisible = useCallback(
    (modelId: string, visible: boolean) => {
      const nextHidden = visible
        ? hiddenModels.filter((model) => model !== modelId)
        : [...hiddenModels.filter((model) => model !== modelId), modelId];
      updatePreferences.mutate({ hiddenModels: nextHidden });
    },
    [hiddenModels, updatePreferences]
  );

  const addCustomModel = useCallback(() => {
    const modelId = customModelDraft.trim();
    if (!isValidCustomModelId(modelId)) {
      setCustomModelError(t('agents.models.customInvalid'));
      return;
    }
    if (customModels.includes(modelId)) {
      setCustomModelError(t('agents.models.customDuplicate'));
      return;
    }
    if (customModels.length >= MAX_CUSTOM_RUNTIME_MODELS) {
      setCustomModelError(t('agents.models.customLimit', { count: MAX_CUSTOM_RUNTIME_MODELS }));
      return;
    }
    setCustomModelError(null);
    updatePreferences.mutate(
      { customModels: [...customModels, modelId] },
      {
        onSuccess: () => setCustomModelDraft(''),
      }
    );
  }, [customModelDraft, customModels, t, updatePreferences]);

  const removeCustomModel = useCallback(
    (modelId: string) => {
      setCustomModelError(null);
      updatePreferences.mutate({
        customModels: customModels.filter((model) => model !== modelId),
      });
    },
    [customModels, updatePreferences]
  );

  const content = (
    <AgentSection
      title={t('agents.models.title')}
      description={t('agents.models.description')}
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => refreshModels.mutate()}
          disabled={disabled}
          className="gap-1.5"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshModels.isPending && 'animate-spin')} />
          {refreshModels.isPending ? t('agents.models.refreshing') : t('agents.models.refresh')}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="rounded-md border border-border bg-background-secondary/40 p-3">
          <div className="text-sm font-medium">{t('agents.models.customTitle')}</div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t('agents.models.customDescription', { count: MAX_CUSTOM_RUNTIME_MODELS })}
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
              aria-label={t('agents.models.customInput')}
              placeholder={t('agents.models.customPlaceholder')}
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
              {t('agents.models.customAdd')}
            </Button>
          </div>
          {(customModelError || updatePreferences.isError) && (
            <p className="mt-2 text-xs text-destructive" role="alert">
              {customModelError ?? t('agents.models.saveFailed')}
            </p>
          )}
        </div>
        <ModelStatusRow result={modelQuery.data} />
        <ModelList
          models={models}
          customModels={customModels}
          isLoading={modelQuery.isLoading}
          disabled={disabled}
          onVisibleChange={setModelVisible}
          onRemoveCustom={removeCustomModel}
        />
      </div>
    </AgentSection>
  );

  return <div className={cn(!embedded && 'mx-auto w-full max-w-4xl px-6 py-6')}>{content}</div>;
};

const ModelStatusRow: React.FC<{
  result: AgentModelCandidateInferenceResult | undefined;
}> = ({ result }) => {
  const { t } = useTranslation();
  const syncError = result?.sources.find((source) => source.error)?.error;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
      <Badge variant={syncError ? 'destructive' : 'secondary'}>
        {syncError
          ? t('agents.models.statusFailed')
          : result?.cached
            ? t('agents.models.statusCached')
            : t('agents.models.statusFresh')}
      </Badge>
      <span>{t('agents.models.visibleCount', { count: result?.candidates.length ?? 0 })}</span>
      {syncError && (
        <span className="max-w-80 truncate text-destructive" title={syncError}>
          {syncError}
        </span>
      )}
    </div>
  );
};

const ModelList: React.FC<{
  models: AgentModelCandidateItem[];
  customModels: string[];
  isLoading: boolean;
  disabled: boolean;
  onVisibleChange: (modelId: string, visible: boolean) => void;
  onRemoveCustom: (modelId: string) => void;
}> = ({ models, customModels, isLoading, disabled, onVisibleChange, onRemoveCustom }) => {
  const { t } = useTranslation();
  const customModelIds = useMemo(() => new Set(customModels), [customModels]);

  if (isLoading) {
    return (
      <div className="rounded-md border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
        {t('agents.models.loading')}
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-3 py-8 text-center">
        <div className="text-sm font-medium">{t('agents.models.emptyTitle')}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {t('agents.models.emptyDescription')}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      {models.map((model) => {
        const isCustom = customModelIds.has(model.id);
        return (
          <div
            key={model.id}
            className={cn(
              'flex items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0',
              !model.visible && 'bg-muted/25 text-muted-foreground'
            )}
          >
            <Checkbox
              checked={model.visible}
              disabled={disabled}
              onCheckedChange={(checked) => onVisibleChange(model.id, checked === true)}
              aria-label={t('agents.models.toggleVisible', { model: model.id })}
            />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <code className="truncate font-mono text-xs">{model.id}</code>
                {isCustom && <Badge variant="secondary">{t('agents.models.customBadge')}</Badge>}
                {!model.visible && <EyeOff className="h-3.5 w-3.5 shrink-0" />}
              </div>
            </div>
            {isCustom && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t('agents.models.removeCustom', { model: model.id })}
                title={t('agents.models.removeCustom', { model: model.id })}
                onClick={() => onRemoveCustom(model.id)}
                disabled={disabled}
                className="shrink-0 text-foreground-muted hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
};

function isValidCustomModelId(value: string): boolean {
  return value.length >= 2 && value.length <= 100 && /^[a-z0-9][a-z0-9._:/+-]*$/i.test(value);
}
