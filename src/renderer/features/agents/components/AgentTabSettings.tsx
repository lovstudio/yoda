import { useQuery } from '@tanstack/react-query';
import { FolderOpen, RefreshCw, RotateCcw, Save, Settings2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RuntimeCustomConfig } from '@shared/app-settings';
import type { AgentModelCandidateInferenceResult } from '@shared/runtime-model-candidates';
import { expandRuntimeHome, resolveRuntimePaths } from '@shared/runtime-paths';
import { getRuntime, type RuntimeId } from '@shared/runtime-registry';
import CustomCommandModal from '@renderer/features/settings/components/CustomCommandModal';
import StatuslineSettingsCard from '@renderer/features/settings/components/StatuslineSettingsCard';
import { useRuntimeSettings } from '@renderer/features/settings/use-runtime-settings';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import { Textarea } from '@renderer/lib/ui/textarea';
import { log } from '@renderer/utils/logger';
import { AgentSection } from './AgentSection';

export const AgentTabSettings: React.FC<{ agentId: RuntimeId }> = observer(
  function AgentTabSettings({ agentId }) {
    const { t } = useTranslation();
    const [customOpen, setCustomOpen] = useState(false);
    const provider = getRuntime(agentId);
    const paths = resolveRuntimePaths(agentId);

    if (!provider) return null;

    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-6">
        <AgentSection
          title={t('agents.settings.execTitle')}
          description={t('agents.settings.execDescription', { name: provider.name })}
        >
          <Button variant="outline" size="sm" onClick={() => setCustomOpen(true)}>
            <Settings2 className="mr-1 h-3.5 w-3.5" />
            {t('agents.settings.editExec')}
          </Button>
        </AgentSection>

        <AgentDefaultModelSettings agentId={agentId} agentName={provider.name} />

        <AgentNamingSettings agentId={agentId} agentName={provider.name} />

        {agentId === 'claude' && (
          <AgentSection title={t('settings.statusline.title')}>
            <StatuslineSettingsCard />
          </AgentSection>
        )}

        <AgentSection
          title={t('agents.settings.configTitle')}
          description={t('agents.settings.configDescription')}
        >
          {paths.config ? (
            <ConfigPathRow path={paths.config} />
          ) : (
            <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs leading-relaxed text-muted-foreground">
              {t('agents.settings.noConfig', { name: provider.name })}
            </p>
          )}
          {paths.settings && paths.settings !== paths.config && (
            <div className="mt-2">
              <ConfigPathRow path={paths.settings} />
            </div>
          )}
        </AgentSection>

        <CustomCommandModal
          isOpen={customOpen}
          onClose={() => setCustomOpen(false)}
          runtimeId={agentId}
        />
      </div>
    );
  }
);

const AgentDefaultModelSettings: React.FC<{ agentId: RuntimeId; agentName: string }> = ({
  agentId,
  agentName,
}) => {
  const { t } = useTranslation();
  const { value, isLoading, isSaving, update } = useRuntimeSettings(agentId);
  const applied = value?.defaultModel ?? '';
  const [draftModel, setDraftModel] = useState<string>();
  const model = draftModel ?? applied;

  const save = () => {
    const next: RuntimeCustomConfig = { ...(value ?? {}) };
    const trimmed = model.trim();
    if (trimmed) next.defaultModel = trimmed;
    else delete next.defaultModel;
    update(next);
  };

  return (
    <AgentSection
      title={t('agents.settings.defaultModelTitle')}
      description={t('agents.settings.defaultModelDescription', { name: agentName })}
    >
      <div className="flex items-center gap-2">
        <Input
          value={model}
          disabled={isLoading || isSaving}
          onChange={(event) => setDraftModel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save();
          }}
          placeholder={t('agents.settings.defaultModelPlaceholder')}
          className="h-8 flex-1 font-mono text-xs"
        />
        <Button
          type="button"
          size="sm"
          onClick={save}
          disabled={isLoading || isSaving || model.trim() === applied}
        >
          <Save className="h-3.5 w-3.5" />
          {t('common.save')}
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {t('agents.settings.defaultModelPriority')}
      </p>
    </AgentSection>
  );
};

const AgentNamingSettings: React.FC<{ agentId: RuntimeId; agentName: string }> = ({
  agentId,
  agentName,
}) => {
  const { t } = useTranslation();
  const { value, defaults, isLoading, isSaving, update } = useRuntimeSettings(agentId);
  const [candidateRefreshToken, setCandidateRefreshToken] = useState(0);
  const [model, setModel] = useState('');
  const [command, setCommand] = useState('');
  const [saving, setSaving] = useState(false);
  const modelCandidateQuery = useQuery<AgentModelCandidateInferenceResult>({
    queryKey: ['runtimeSettings', agentId, 'namingModelCandidates', candidateRefreshToken],
    queryFn: () =>
      rpc.runtimeSettings.inferNamingModelCandidates(agentId, {
        forceRefresh: candidateRefreshToken > 0,
      }) as Promise<AgentModelCandidateInferenceResult>,
    staleTime: 60_000,
  });

  const applied = useMemo(
    () => ({
      model: value?.namingModel ?? '',
      command: value?.namingCommand ?? '',
    }),
    [value?.namingCommand, value?.namingModel]
  );
  const defaultValues = useMemo(
    () => ({
      model: defaults?.namingModel ?? '',
      command: defaults?.namingCommand ?? '',
    }),
    [defaults?.namingCommand, defaults?.namingModel]
  );

  useEffect(() => {
    if (isLoading) return;
    setModel(applied.model);
    setCommand(applied.command);
  }, [applied, isLoading]);

  const resetToDefaults = useCallback(() => {
    setModel(defaultValues.model);
    setCommand(defaultValues.command);
  }, [defaultValues]);

  const modelCandidates = modelCandidateQuery.data?.candidates ?? [];

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const next: RuntimeCustomConfig = {
        ...(value ?? {}),
        namingModel: model.trim(),
        namingCommand: command.trim(),
      };
      await new Promise<void>((resolve, reject) =>
        update(next, { onSuccess: resolve, onError: reject })
      );
    } catch (error) {
      log.error('Failed to save agent naming settings:', error);
    } finally {
      setSaving(false);
    }
  }, [command, model, update, value]);

  const disabled = isLoading || isSaving || saving;
  const hasChanges = model !== applied.model || command !== applied.command;
  const hasDefault = defaultValues.model.length > 0 || defaultValues.command.length > 0;

  return (
    <AgentSection
      title={t('agents.settings.namingTitle')}
      description={t('agents.settings.namingDescription', { name: agentName })}
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${agentId}-naming-model`} className="text-xs font-medium">
            {t('agents.settings.namingModel')}
          </Label>
          <Input
            id={`${agentId}-naming-model`}
            value={model}
            disabled={disabled}
            onChange={(event) => setModel(event.target.value)}
            placeholder={t('agents.settings.namingModelPlaceholder')}
            className="h-8 font-mono text-xs"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-xs text-muted-foreground">
              {t('agents.settings.namingCandidates')}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              title={t('agents.settings.namingRefreshCandidates')}
              onClick={() => setCandidateRefreshToken((current) => current + 1)}
              disabled={disabled || modelCandidateQuery.isFetching}
              className="h-6 w-6 p-0"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            {modelCandidateQuery.isFetching ? (
              <span className="text-xs text-muted-foreground">
                {t('agents.settings.namingCandidatesLoading')}
              </span>
            ) : modelCandidates.length > 0 ? (
              <>
                {modelCandidates.map((candidate) => (
                  <Button
                    key={candidate}
                    type="button"
                    variant="outline"
                    size="xs"
                    title={candidate}
                    onClick={() => setModel(candidate)}
                    disabled={disabled}
                    className="max-w-full font-mono"
                  >
                    <span className="max-w-44 truncate">{candidate}</span>
                  </Button>
                ))}
              </>
            ) : (
              <span className="text-xs text-muted-foreground">
                {t('agents.settings.namingCandidatesEmpty')}
              </span>
            )}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${agentId}-naming-command`} className="text-xs font-medium">
            {t('agents.settings.namingCommand')}
          </Label>
          <Textarea
            id={`${agentId}-naming-command`}
            value={command}
            disabled={disabled}
            onChange={(event) => setCommand(event.target.value)}
            placeholder={t('agents.settings.namingCommandPlaceholder')}
            className="min-h-20 resize-y font-mono text-xs"
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t('agents.settings.namingCommandHint')}
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={resetToDefaults}
            disabled={disabled || !hasDefault}
            className="gap-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t('settings.customCommand.resetToDefaults')}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleSave()}
            disabled={disabled || !hasChanges}
            className="gap-1.5"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? t('settings.customCommand.saving') : t('common.save')}
          </Button>
        </div>
      </div>
    </AgentSection>
  );
};

const ConfigPathRow: React.FC<{ path: string }> = ({ path }) => {
  const { t } = useTranslation();
  const handleOpen = async () => {
    const home = await rpc.app.getHomeDir();
    await rpc.app.openIn({ app: 'finder', path: expandRuntimeHome(path, home) });
  };
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <code className="truncate font-mono text-xs text-foreground">{path}</code>
      <Button variant="ghost" size="sm" onClick={() => void handleOpen()}>
        <FolderOpen className="mr-1 h-3.5 w-3.5" />
        {t('agents.openInFinder')}
      </Button>
    </div>
  );
};
