import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { Bug, CheckCircle2, Loader2, Plus, RefreshCw, Send, Trash2, XCircle } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GlobalLlmSettings } from '@shared/app-settings';
import {
  createDefaultLlmProfile,
  getLlmProfile,
  LLM_REASONING_EFFORT_IDS,
  normalizeLlmSettings,
  type GlobalLlmDebugResult,
  type GlobalLlmModelCandidate,
  type GlobalLlmModelDiscoveryResult,
  type GlobalLlmSettingsShape,
  type LlmProfile,
  type LlmReasoningEffort,
} from '@shared/global-llm';
import { MAAS_PLATFORMS, type MaasPlatformId } from '@shared/maas';
import {
  AGENT_ACCOUNT_PROVIDER_IDS,
  getDefaultPermissionModeId,
  getRuntime,
  getRuntimeAccountProfile,
  getRuntimePermissionModes,
  type AgentAccountProviderId,
  type RuntimeId,
} from '@shared/runtime-registry';
import { useMaasConnections } from '@renderer/features/maas/useMaas';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { MicroLabel } from '@renderer/lib/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Switch } from '@renderer/lib/ui/switch';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';
import { SettingRow } from './SettingRow';

type LlmSettingsController = {
  settings: GlobalLlmSettingsShape;
  updateLlm: (partial: Partial<GlobalLlmSettings>) => void;
  disabled: boolean;
};

type ProfileSelectProps = {
  settings: GlobalLlmSettingsShape;
  disabled: boolean;
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
};

export const LlmProfilesCard: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateLlm, disabled } = useLlmSettingsController();
  const { data: maasConnections } = useMaasConnections();
  const [selectedProfileId, setSelectedProfileId] = useState(settings.defaultProfileId);
  const [modelRefreshToken, setModelRefreshToken] = useState(0);

  const effectiveSelectedProfileId = settings.profiles.some(
    (profile) => profile.id === selectedProfileId
  )
    ? selectedProfileId
    : settings.defaultProfileId;
  const selectedProfile = getLlmProfile(settings, effectiveSelectedProfileId);
  const accountProfile = getRuntimeAccountProfile(selectedProfile.runtimeId);
  const connectedMaasCount =
    maasConnections?.filter((connection) => connection.connected).length ?? 0;
  const selectedMaasConnection = maasConnections?.find(
    (connection) => connection.platformId === selectedProfile.maasPlatformId
  );
  const modelDiscoveryQuery = useQuery<GlobalLlmModelDiscoveryResult>({
    queryKey: [
      'llm',
      'modelDiscovery',
      selectedProfile.runtimeId,
      selectedProfile.authProvider,
      selectedProfile.maasPlatformId,
      modelRefreshToken,
    ] as const,
    queryFn: () =>
      rpc.llm.discoverModels({
        runtimeId: selectedProfile.runtimeId,
        authProvider: selectedProfile.authProvider,
        maasPlatformId: selectedProfile.maasPlatformId,
        forceRefresh: modelRefreshToken > 0,
      }) as Promise<GlobalLlmModelDiscoveryResult>,
    staleTime: 60_000,
  });
  const modelCandidates = modelDiscoveryQuery.data?.models ?? [];
  const modelDiscoveryError = modelDiscoveryQuery.data?.sources.find(
    (source) => source.error
  )?.error;

  const updateProfile = (profileId: string, patch: Partial<LlmProfile>) => {
    const profiles = settings.profiles.map((profile) =>
      profile.id === profileId ? { ...profile, ...patch } : profile
    );
    updateLlm({ profiles });
  };

  const addProfile = () => {
    const used = new Set(settings.profiles.map((profile) => profile.id));
    let index = settings.profiles.length + 1;
    let id = `profile-${index}`;
    while (used.has(id)) {
      index += 1;
      id = `profile-${index}`;
    }
    const profile = createDefaultLlmProfile({
      ...selectedProfile,
      id,
      name: t('settings.llm.newProfileName', { index: settings.profiles.length + 1 }),
    });
    updateLlm({ profiles: [...settings.profiles, profile] });
    setSelectedProfileId(profile.id);
  };

  const deleteProfile = () => {
    if (settings.profiles.length <= 1) return;
    const profiles = settings.profiles.filter((profile) => profile.id !== selectedProfile.id);
    const fallbackId = profiles[0]?.id ?? settings.defaultProfileId;
    updateLlm({
      profiles,
      defaultProfileId:
        settings.defaultProfileId === selectedProfile.id ? fallbackId : settings.defaultProfileId,
      namingProfileId:
        settings.namingProfileId === selectedProfile.id ? fallbackId : settings.namingProfileId,
      promptTranslationProfileId:
        settings.promptTranslationProfileId === selectedProfile.id
          ? fallbackId
          : settings.promptTranslationProfileId,
    });
    setSelectedProfileId(fallbackId);
  };

  return (
    <div className="@container">
      <div className="grid min-w-0 gap-4 @4xl:grid-cols-[240px_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <MicroLabel className="text-foreground-passive">
              {t('settings.llm.profiles')}
            </MicroLabel>
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              onClick={addProfile}
              disabled={disabled}
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
          <div className="flex min-w-0 flex-col gap-1 rounded-md border border-border p-1">
            {settings.profiles.map((profile) => {
              const runtimeName = getRuntime(profile.runtimeId)?.name ?? profile.runtimeId;
              return (
                <button
                  key={profile.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setSelectedProfileId(profile.id)}
                  className={cn(
                    'flex min-w-0 flex-col gap-0.5 rounded-sm px-2 py-2 text-left text-sm transition-colors',
                    profile.id === selectedProfile.id
                      ? 'bg-background-2 text-foreground'
                      : 'text-foreground-muted hover:bg-background-1 hover:text-foreground'
                  )}
                >
                  <span className="truncate">{profile.name}</span>
                  <span className="truncate text-xs text-foreground-passive">{runtimeName}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <SettingRow
            title={t('settings.llm.profileName')}
            description={t('settings.llm.profileNameDescription')}
            control={
              <div className="flex items-center gap-2">
                <Input
                  key={selectedProfile.id}
                  defaultValue={selectedProfile.name}
                  disabled={disabled}
                  className="h-8 w-56 max-w-full"
                  onBlur={(event) => {
                    const name = event.target.value.trim();
                    if (name && name !== selectedProfile.name) {
                      updateProfile(selectedProfile.id, { name });
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={disabled || settings.profiles.length <= 1}
                  onClick={deleteProfile}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            }
          />
          <SettingRow
            title={t('settings.llm.agentClient')}
            description={t('settings.llm.agentClientDescription')}
            control={
              <div className="w-56 max-w-full shrink-0">
                <AgentSelector
                  value={selectedProfile.runtimeId}
                  onChange={(runtimeId: RuntimeId) =>
                    updateProfile(selectedProfile.id, {
                      runtimeId,
                      permissionMode: getDefaultPermissionModeId(runtimeId),
                    })
                  }
                  disabled={disabled}
                  className="h-8"
                />
              </div>
            }
          />
          <SettingRow
            title={t('settings.llm.accessMethod')}
            description={t('settings.llm.accessMethodDescription')}
            control={
              <Select
                value={selectedProfile.authProvider}
                onValueChange={(value) =>
                  updateProfile(selectedProfile.id, {
                    authProvider: value as AgentAccountProviderId,
                  })
                }
                disabled={disabled}
              >
                <SelectTrigger className="h-8 w-56 max-w-full">
                  <SelectValue>
                    {() => accessMethodLabel(t, selectedProfile.authProvider)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {AGENT_ACCOUNT_PROVIDER_IDS.map((id) => (
                    <SelectItem
                      key={id}
                      value={id}
                      disabled={!isAccessMethodSupported(accountProfile, id)}
                    >
                      {accessMethodLabel(t, id)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          <SettingRow
            title={t('settings.llm.maasPlatform')}
            description={t('settings.llm.maasPlatformDescription', {
              count: connectedMaasCount,
              status: selectedMaasConnection?.connected
                ? t('settings.llm.maasConnected')
                : t('settings.llm.maasNotConnected'),
            })}
            control={
              <Select
                value={selectedProfile.maasPlatformId}
                onValueChange={(value) =>
                  updateProfile(selectedProfile.id, { maasPlatformId: value as MaasPlatformId })
                }
                disabled={disabled || selectedProfile.authProvider !== 'yoda-maas'}
              >
                <SelectTrigger className="h-8 w-56 max-w-full">
                  <SelectValue>
                    {() => MAAS_PLATFORMS[selectedProfile.maasPlatformId].name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.values(MAAS_PLATFORMS).map((platform) => (
                    <SelectItem key={platform.id} value={platform.id}>
                      {platform.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          <SettingRow
            title={t('settings.llm.model')}
            description={t('settings.llm.modelDescription')}
            control={
              <ModelField
                key={selectedProfile.id}
                profile={selectedProfile}
                candidates={modelCandidates}
                disabled={disabled}
                loading={modelDiscoveryQuery.isFetching}
                error={modelDiscoveryError}
                onRefresh={() => setModelRefreshToken((current) => current + 1)}
                onModelChange={(model) => updateProfile(selectedProfile.id, { model })}
              />
            }
          />
          <SettingRow
            title={t('settings.llm.reasoningEffort')}
            description={t('settings.llm.reasoningEffortDescription')}
            control={
              <Select
                value={selectedProfile.reasoningEffort}
                onValueChange={(value) =>
                  updateProfile(selectedProfile.id, {
                    reasoningEffort: value as LlmReasoningEffort,
                  })
                }
                disabled={disabled}
              >
                <SelectTrigger className="h-8 w-56 max-w-full">
                  <SelectValue>
                    {() => t(`settings.llm.reasoning.${selectedProfile.reasoningEffort}`)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {LLM_REASONING_EFFORT_IDS.map((id) => (
                    <SelectItem key={id} value={id}>
                      {t(`settings.llm.reasoning.${id}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          <SettingRow
            title={t('settings.llm.permissionMode')}
            description={t('settings.llm.permissionModeDescription')}
            control={
              <Select
                value={selectedProfile.permissionMode}
                onValueChange={(value) => {
                  if (value) updateProfile(selectedProfile.id, { permissionMode: value });
                }}
                disabled={disabled}
              >
                <SelectTrigger className="h-8 w-56 max-w-full">
                  <SelectValue>
                    {(value: string | null) =>
                      t(
                        getRuntimePermissionModes(selectedProfile.runtimeId).find(
                          (mode) => mode.id === value
                        )?.labelKey ?? 'permissionMode.default'
                      )
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {getRuntimePermissionModes(selectedProfile.runtimeId).map((mode) => (
                    <SelectItem
                      key={mode.id}
                      value={mode.id}
                      className={cn(mode.danger && 'text-destructive')}
                    >
                      {t(mode.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
        </div>
      </div>
    </div>
  );
};

const MODEL_CANDIDATE_BUTTON_LIMIT = 8;

const ModelField: React.FC<{
  profile: LlmProfile;
  candidates: GlobalLlmModelCandidate[];
  disabled: boolean;
  loading: boolean;
  error: string | undefined;
  onRefresh: () => void;
  onModelChange: (model: string) => void;
}> = ({ profile, candidates, disabled, loading, error, onRefresh, onModelChange }) => {
  const { t } = useTranslation();
  const visibleCandidates = candidates.slice(0, MODEL_CANDIDATE_BUTTON_LIMIT);
  const hiddenCandidateCount = Math.max(0, candidates.length - visibleCandidates.length);

  return (
    <div className="flex w-64 max-w-full flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <Input
          key={`${profile.id}:${profile.model}`}
          defaultValue={profile.model}
          disabled={disabled}
          placeholder={t('settings.llm.modelPlaceholder')}
          className="h-8 min-w-0 flex-1"
          onBlur={(event) => {
            const model = event.target.value.trim();
            if (model !== profile.model) onModelChange(model);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          title={t('settings.llm.modelDiscoveryRefresh')}
          onClick={onRefresh}
          disabled={disabled || loading}
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
        </Button>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {loading ? (
          <span className="text-xs text-foreground-passive">
            {t('settings.llm.modelDiscoveryLoading')}
          </span>
        ) : visibleCandidates.length > 0 ? (
          <>
            {visibleCandidates.map((candidate) => (
              <Button
                key={candidate.id}
                type="button"
                variant={candidate.id === profile.model ? 'secondary' : 'outline'}
                size="xs"
                title={modelCandidateTitle(t, candidate)}
                onClick={() => onModelChange(candidate.id)}
                disabled={disabled}
                className="max-w-full font-mono"
              >
                <span className="max-w-44 truncate">{candidate.id}</span>
              </Button>
            ))}
            {hiddenCandidateCount > 0 && (
              <span className="text-xs text-foreground-passive">
                {t('settings.llm.modelDiscoveryMore', { count: hiddenCandidateCount })}
              </span>
            )}
          </>
        ) : (
          <span className="text-xs text-foreground-passive">
            {t('settings.llm.modelDiscoveryEmpty')}
          </span>
        )}
      </div>
      {error && (
        <span className="truncate text-xs text-foreground-passive" title={error}>
          {t('settings.llm.modelDiscoveryPartial', { error })}
        </span>
      )}
    </div>
  );
};

export const LlmProfileAssignmentsCard: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateLlm, disabled } = useLlmSettingsController();

  return (
    <div className="@container flex min-w-0 flex-col gap-3">
      <SettingRow
        title={t('settings.llm.defaultProfile')}
        description={t('settings.llm.defaultProfileDescription')}
        control={
          <ProfileSelect
            settings={settings}
            disabled={disabled}
            value={settings.defaultProfileId}
            onValueChange={(value) => updateLlm({ defaultProfileId: value })}
          />
        }
      />
      <SettingRow
        title={t('settings.llm.namingProfile')}
        description={t('settings.llm.namingProfileDescription')}
        control={
          <ProfileSelect
            settings={settings}
            disabled={disabled}
            value={settings.namingProfileId}
            onValueChange={(value) => updateLlm({ namingProfileId: value })}
          />
        }
      />
      <SettingRow
        title={t('settings.llm.promptTranslation')}
        description={t('settings.llm.promptTranslationDescription')}
        control={
          <Switch
            checked={settings.promptTranslationEnabled}
            disabled={disabled}
            onCheckedChange={(checked) => updateLlm({ promptTranslationEnabled: checked })}
          />
        }
      />
      <SettingRow
        title={t('settings.llm.promptTranslationProfile')}
        description={t('settings.llm.promptTranslationProfileDescription')}
        control={
          <ProfileSelect
            settings={settings}
            disabled={disabled}
            value={settings.promptTranslationProfileId}
            onValueChange={(value) => updateLlm({ promptTranslationProfileId: value })}
          />
        }
      />
      <SettingRow
        title={t('settings.llm.showOriginalPrompt')}
        description={t('settings.llm.showOriginalPromptDescription')}
        control={
          <Switch
            checked={settings.promptTranslationShowOriginal}
            disabled={disabled || !settings.promptTranslationEnabled}
            onCheckedChange={(checked) => updateLlm({ promptTranslationShowOriginal: checked })}
          />
        }
      />
    </div>
  );
};

export const LlmProfileDebugCard: React.FC = () => {
  const { t } = useTranslation();
  const { settings, disabled } = useLlmSettingsController();
  const [debugProfileId, setDebugProfileId] = useState(settings.defaultProfileId);
  const [debugPrompt, setDebugPrompt] = useState(() => t('settings.llm.debugDefaultPrompt'));
  const [debugResult, setDebugResult] = useState<GlobalLlmDebugResult | null>(null);
  const [debugging, setDebugging] = useState(false);

  const effectiveDebugProfileId = settings.profiles.some((profile) => profile.id === debugProfileId)
    ? debugProfileId
    : settings.defaultProfileId;

  const runDebug = () => {
    const prompt = debugPrompt.trim();
    if (!prompt || debugging) return;
    setDebugging(true);
    setDebugResult(null);
    const profileId = effectiveDebugProfileId || settings.defaultProfileId;
    void rpc.llm
      .debug({ prompt, profileId })
      .then(setDebugResult)
      .catch((error: Error) =>
        setDebugResult({
          success: false,
          profileId: null,
          profileName: null,
          runtimeId: null,
          authProvider: null,
          maasPlatformId: null,
          model: null,
          output: '',
          durationMs: 0,
          error: error.message,
        })
      )
      .finally(() => setDebugging(false));
  };

  return (
    <div className="@container flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-center justify-between gap-3 @max-sm:flex-col @max-sm:items-stretch">
        <div className="flex min-w-0 items-center gap-2">
          <Bug className="size-4 shrink-0 text-foreground-muted" />
          <h3 className="text-sm font-normal text-foreground">{t('settings.llm.debugTitle')}</h3>
        </div>
        <ProfileSelect
          settings={settings}
          disabled={disabled}
          value={effectiveDebugProfileId}
          onValueChange={setDebugProfileId}
          className="w-52 @max-sm:w-full"
        />
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <MicroLabel className="text-foreground-passive">{t('settings.llm.debugPrompt')}</MicroLabel>
        <Textarea
          value={debugPrompt}
          onChange={(event) => setDebugPrompt(event.target.value)}
          className="min-h-24 resize-y"
          disabled={debugging}
        />
        <div className="flex items-center justify-between gap-3 @max-sm:flex-col @max-sm:items-stretch">
          <span className="text-xs text-foreground-passive">{t('settings.llm.debugHint')}</span>
          <Button
            type="button"
            size="sm"
            onClick={runDebug}
            disabled={debugging || !debugPrompt.trim()}
            className="@max-sm:w-full"
          >
            {debugging ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
            {debugging ? t('settings.llm.debugRunning') : t('settings.llm.debugRun')}
          </Button>
        </div>
      </div>
      {debugResult && (
        <div
          className={cn(
            'flex min-w-0 flex-col gap-2 rounded-md border p-3',
            debugResult.success
              ? 'border-emerald-500/20 bg-emerald-500/5'
              : 'border-destructive/20 bg-destructive/5'
          )}
        >
          <div className="flex min-w-0 items-center gap-2 text-xs">
            {debugResult.success ? (
              <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />
            ) : (
              <XCircle className="size-3.5 shrink-0 text-destructive" />
            )}
            <span className="truncate text-foreground-muted">
              {debugResult.success
                ? t('settings.llm.debugSuccess', {
                    profile: debugResult.profileName ?? debugResult.profileId ?? '-',
                    runtime: runtimeLabel(debugResult.runtimeId),
                    access: debugResult.authProvider
                      ? accessMethodLabel(t, debugResult.authProvider)
                      : '-',
                    model: debugResult.model ?? '-',
                    duration: debugResult.durationMs,
                  })
                : t('settings.llm.debugFailed', {
                    error: debugResult.error ?? t('common.unknownError'),
                  })}
            </span>
          </div>
          {debugResult.output && (
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/70 p-2 text-xs text-foreground">
              {debugResult.output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
};

function useLlmSettingsController(): LlmSettingsController {
  const { value: llm, update, isLoading: loading, isSaving: saving } = useAppSettingsKey('llm');
  const settings = useMemo(() => normalizeLlmSettings(llm), [llm]);

  return {
    settings,
    updateLlm: (partial: Partial<GlobalLlmSettings>) => update(partial),
    disabled: loading || saving,
  };
}

function ProfileSelect({
  settings,
  disabled,
  value,
  onValueChange,
  className = 'w-56',
}: ProfileSelectProps) {
  return (
    <Select
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue) onValueChange(nextValue);
      }}
      disabled={disabled}
    >
      <SelectTrigger className={cn('h-8 max-w-full', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {settings.profiles.map((profile) => (
          <SelectItem key={profile.id} value={profile.id}>
            {profile.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function accessMethodLabel(t: TFunction, id: AgentAccountProviderId): string {
  switch (id) {
    case 'official-api':
      return t('settings.llm.access.officialApi');
    case 'yoda-maas':
      return t('settings.llm.access.maas');
    case 'official-subscription':
    default:
      return t('settings.llm.access.officialSubscription');
  }
}

function runtimeLabel(runtimeId: RuntimeId | null): string {
  if (!runtimeId) return '-';
  return getRuntime(runtimeId)?.name ?? runtimeId;
}

function modelCandidateTitle(t: TFunction, candidate: GlobalLlmModelCandidate): string {
  const sources = candidate.sources
    .map((source) => t(`settings.llm.modelDiscoverySources.${source}`))
    .join(', ');
  return candidate.name
    ? `${candidate.id} · ${candidate.name} · ${sources}`
    : `${candidate.id} · ${sources}`;
}

function isAccessMethodSupported(
  profile: ReturnType<typeof getRuntimeAccountProfile>,
  id: AgentAccountProviderId
): boolean {
  switch (id) {
    case 'official-api':
      return profile.officialApi.envVars.length > 0;
    case 'yoda-maas':
      return profile.maas.supported;
    case 'official-subscription':
    default:
      return profile.officialSubscription.supported;
  }
}
