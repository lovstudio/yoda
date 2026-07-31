import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EyeOff, RefreshCw } from 'lucide-react';
import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  AgentModelCandidateInferenceResult,
  AgentModelCandidateItem,
} from '@shared/runtime-model-candidates';
import type { RuntimeId } from '@shared/runtime-registry';
import { rpc } from '@renderer/lib/ipc';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { cn } from '@renderer/utils/utils';
import { AgentSection } from './AgentSection';

type PreferencesInput = {
  hiddenModels?: string[];
};

export const AgentTabModels: React.FC<{ agentId: RuntimeId }> = ({ agentId }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const modelQueryKey = useMemo(() => ['runtimeSettings', agentId, 'models'] as const, [agentId]);

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
    },
  });

  const refreshModels = useMutation<AgentModelCandidateInferenceResult, Error, void>({
    mutationFn: () =>
      rpc.runtimeSettings.inferNamingModelCandidates(agentId, {
        forceRefresh: true,
      }) as Promise<AgentModelCandidateInferenceResult>,
    onSuccess: (result) => {
      queryClient.setQueryData(modelQueryKey, result);
    },
  });

  const hiddenModels = useMemo(() => modelQuery.data?.hiddenModels ?? [], [modelQuery.data]);
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

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-6">
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
          <ModelStatusRow result={modelQuery.data} />
          <ModelList
            models={models}
            isLoading={modelQuery.isLoading}
            disabled={disabled}
            onVisibleChange={setModelVisible}
          />
        </div>
      </AgentSection>
    </div>
  );
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
  isLoading: boolean;
  disabled: boolean;
  onVisibleChange: (modelId: string, visible: boolean) => void;
}> = ({ models, isLoading, disabled, onVisibleChange }) => {
  const { t } = useTranslation();

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
                {!model.visible && <EyeOff className="h-3.5 w-3.5 shrink-0" />}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
