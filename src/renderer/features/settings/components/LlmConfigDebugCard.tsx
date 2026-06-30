import type { TFunction } from 'i18next';
import { Bug, CheckCircle2, Loader2, Plus, Send, Trash2, XCircle } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GlobalLlmSettings } from '@shared/app-settings';
import {
  createDefaultLlmProfile,
  getLlmProfile,
  LLM_REASONING_EFFORT_IDS,
  normalizeLlmSettings,
  type GlobalLlmDebugResult,
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
import { Separator } from '@renderer/lib/ui/separator';
import { Switch } from '@renderer/lib/ui/switch';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';
import { SettingRow } from './SettingRow';

export const LlmConfigDebugCard: React.FC = () => {
  const { t } = useTranslation();
  const { value: llm, update, isLoading: loading, isSaving: saving } = useAppSettingsKey('llm');
  const { data: maasConnections } = useMaasConnections();
  const settings = useMemo(() => normalizeLlmSettings(llm), [llm]);
  const [selectedProfileId, setSelectedProfileId] = useState(settings.defaultProfileId);
  const [debugProfileId, setDebugProfileId] = useState(settings.defaultProfileId);
  const [debugPrompt, setDebugPrompt] = useState(() => t('settings.llm.debugDefaultPrompt'));
  const [debugResult, setDebugResult] = useState<GlobalLlmDebugResult | null>(null);
  const [debugging, setDebugging] = useState(false);

  const effectiveSelectedProfileId = settings.profiles.some(
    (profile) => profile.id === selectedProfileId
  )
    ? selectedProfileId
    : settings.defaultProfileId;
  const effectiveDebugProfileId = settings.profiles.some((profile) => profile.id === debugProfileId)
    ? debugProfileId
    : settings.defaultProfileId;
  const selectedProfile = getLlmProfile(settings, effectiveSelectedProfileId);
  const accountProfile = getRuntimeAccountProfile(selectedProfile.runtimeId);
  const disabled = loading || saving;
  const connectedMaasCount =
    maasConnections?.filter((connection) => connection.connected).length ?? 0;
  const selectedMaasConnection = maasConnections?.find(
    (connection) => connection.platformId === selectedProfile.maasPlatformId
  );

  const updateLlm = (partial: Partial<GlobalLlmSettings>) => update(partial);

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

  const renderProfileSelect = (
    value: string,
    onValueChange: (value: string) => void,
    className = 'w-56'
  ) => (
    <Select
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue) onValueChange(nextValue);
      }}
      disabled={disabled}
    >
      <SelectTrigger className={cn('h-8', className)}>
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

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid min-w-0 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
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
                  className="h-8 w-56"
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
              <div className="w-56 shrink-0">
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
                <SelectTrigger className="h-8 w-56">
                  <SelectValue />
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
                <SelectTrigger className="h-8 w-56">
                  <SelectValue />
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
              <Input
                key={`${selectedProfile.id}:${selectedProfile.model}`}
                defaultValue={selectedProfile.model}
                disabled={disabled}
                placeholder={t('settings.llm.modelPlaceholder')}
                className="h-8 w-56"
                onBlur={(event) => {
                  const model = event.target.value.trim();
                  if (model !== selectedProfile.model) updateProfile(selectedProfile.id, { model });
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
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
                <SelectTrigger className="h-8 w-56">
                  <SelectValue />
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
                <SelectTrigger className="h-8 w-56">
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

      <Separator />

      <div className="flex min-w-0 flex-col gap-3">
        <SettingRow
          title={t('settings.llm.defaultProfile')}
          description={t('settings.llm.defaultProfileDescription')}
          control={renderProfileSelect(settings.defaultProfileId, (value) =>
            updateLlm({ defaultProfileId: value })
          )}
        />
        <SettingRow
          title={t('settings.llm.namingProfile')}
          description={t('settings.llm.namingProfileDescription')}
          control={renderProfileSelect(settings.namingProfileId, (value) =>
            updateLlm({ namingProfileId: value })
          )}
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
          control={renderProfileSelect(settings.promptTranslationProfileId, (value) =>
            updateLlm({ promptTranslationProfileId: value })
          )}
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

      <Separator />

      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Bug className="size-4 shrink-0 text-foreground-muted" />
            <h3 className="text-sm font-normal text-foreground">{t('settings.llm.debugTitle')}</h3>
          </div>
          {renderProfileSelect(effectiveDebugProfileId, setDebugProfileId, 'w-52')}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <MicroLabel className="text-foreground-passive">
            {t('settings.llm.debugPrompt')}
          </MicroLabel>
          <Textarea
            value={debugPrompt}
            onChange={(event) => setDebugPrompt(event.target.value)}
            className="min-h-24 resize-y"
            disabled={debugging}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-foreground-passive">{t('settings.llm.debugHint')}</span>
            <Button
              type="button"
              size="sm"
              onClick={runDebug}
              disabled={debugging || !debugPrompt.trim()}
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
    </div>
  );
};

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
