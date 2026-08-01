import { ChevronDown, ExternalLink, RotateCcw, Save } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RuntimeCustomConfig } from '@shared/app-settings';
import {
  resolveModelProvider,
  toRuntimeModelId,
  type ModelProviderCatalogGroup,
  type ModelProviderCatalogSource,
} from '@shared/model-provider-catalog';
import type { RuntimeId } from '@shared/runtime-registry';
import { useModelProviderCatalog } from '@renderer/features/settings/model-provider-catalog-query';
import { useRuntimeSettings } from '@renderer/features/settings/use-runtime-settings';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxTrigger,
} from '@renderer/lib/ui/combobox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Switch } from '@renderer/lib/ui/switch';
import { isImeComposing } from '@renderer/utils/ime';

const CODEX_REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
] as const;
const DEFAULT_CODEX_REASONING_EFFORT = 'medium';

type ModelOption = {
  key: string;
  providerId: string;
  providerName: string;
  catalogModelId: string;
  runtimeModelId: string;
  sources: ModelProviderCatalogSource[];
};

type ModelOptionGroup = {
  value: string;
  label: string;
  items: ModelOption[];
};

export type SessionModelEditorProps = {
  runtimeId: RuntimeId;
  currentModel: string | null;
  currentModelSource: string;
  reasoningEffort?: string | null;
  fastMode?: boolean | null;
  onRestartWithModel: (settings: SessionModelSettings) => Promise<void>;
  onManageModels: () => void;
  allowDefaultChange: boolean;
};

export type SessionModelSettings = {
  model: string;
  reasoningEffort?: string;
  fastMode?: boolean;
};

export function SessionModelEditor({
  runtimeId,
  currentModel,
  currentModelSource,
  reasoningEffort,
  fastMode,
  onRestartWithModel,
  onManageModels,
  allowDefaultChange,
}: SessionModelEditorProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const showConfirm = useShowModal('confirmActionModal');
  const fastModeControlId = useId();
  const catalogQuery = useModelProviderCatalog();
  const {
    value: runtimeSettings,
    isLoading,
    isSaving,
    updateAsync,
  } = useRuntimeSettings(runtimeId);
  const groups = useMemo(
    () => buildModelOptionGroups(catalogQuery.data?.providers ?? []),
    [catalogQuery.data]
  );
  const options = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const appliedModel = currentModel?.trim() ?? '';
  const codexParameters = runtimeId === 'codex';
  const [selectedOption, setSelectedOption] = useState<ModelOption | null>(null);
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState(
    DEFAULT_CODEX_REASONING_EFFORT
  );
  const [selectedFastMode, setSelectedFastMode] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [savedDefaults, setSavedDefaults] = useState<SessionModelSettings>();

  useEffect(() => {
    setSelectedOption(findModelOption(options, appliedModel));
  }, [appliedModel, options]);

  useEffect(() => {
    setSavedDefaults(undefined);
  }, [runtimeId]);

  const appliedReasoningEffort =
    reasoningEffort?.trim() ||
    runtimeSettings?.defaultReasoningEffort?.trim() ||
    DEFAULT_CODEX_REASONING_EFFORT;
  const appliedFastMode = fastMode ?? runtimeSettings?.defaultFastMode ?? false;

  useEffect(() => {
    if (!codexParameters) return;
    setSelectedReasoningEffort(appliedReasoningEffort);
    setSelectedFastMode(appliedFastMode);
  }, [appliedFastMode, appliedReasoningEffort, codexParameters, runtimeId]);

  const selectedModel = selectedOption?.runtimeModelId ?? appliedModel;
  const defaultModel = savedDefaults?.model ?? runtimeSettings?.defaultModel?.trim() ?? '';
  const defaultReasoningEffort =
    savedDefaults?.reasoningEffort ?? runtimeSettings?.defaultReasoningEffort?.trim();
  const defaultFastMode = savedDefaults?.fastMode ?? runtimeSettings?.defaultFastMode;
  const provider = selectedOption
    ? { id: selectedOption.providerId, name: selectedOption.providerName }
    : resolveModelProvider(selectedModel);
  const busy = isRestarting || isSaving;
  const currentSettingsChanged =
    selectedModel !== appliedModel ||
    (codexParameters &&
      (selectedReasoningEffort !== appliedReasoningEffort || selectedFastMode !== appliedFastMode));
  const defaultSettingsChanged =
    selectedModel !== defaultModel ||
    (codexParameters &&
      (selectedReasoningEffort !== defaultReasoningEffort || selectedFastMode !== defaultFastMode));
  const canRestart = Boolean(selectedModel && currentSettingsChanged && !busy);
  const canSaveDefault = Boolean(
    allowDefaultChange &&
      selectedModel &&
      defaultSettingsChanged &&
      runtimeSettings &&
      !isLoading &&
      !busy
  );

  const restartWithModel = async () => {
    if (!selectedModel) return;
    setIsRestarting(true);
    try {
      await onRestartWithModel({
        model: selectedModel,
        ...(codexParameters
          ? { reasoningEffort: selectedReasoningEffort, fastMode: selectedFastMode }
          : {}),
      });
      toast.success(
        t(
          codexParameters
            ? 'workspaceRuntime.model.restartSuccessWithParameters'
            : 'workspaceRuntime.model.restartSuccess',
          {
            model: selectedModel,
            effort: selectedReasoningEffort,
            speed: t(
              selectedFastMode
                ? 'workspaceRuntime.model.fastSpeed'
                : 'workspaceRuntime.model.standardSpeed'
            ),
          }
        )
      );
    } catch (error) {
      toast.error(t('workspaceRuntime.model.restartFailed'), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsRestarting(false);
    }
  };

  const confirmRestart = () => {
    if (!selectedModel || !canRestart) return;
    showConfirm({
      title: t('workspaceRuntime.model.restartTitle'),
      description: t(
        codexParameters
          ? 'workspaceRuntime.model.restartDescriptionWithParameters'
          : 'workspaceRuntime.model.restartDescription',
        {
          model: selectedModel,
          effort: selectedReasoningEffort,
          speed: t(
            selectedFastMode
              ? 'workspaceRuntime.model.fastSpeed'
              : 'workspaceRuntime.model.standardSpeed'
          ),
        }
      ),
      confirmLabel: t('workspaceRuntime.model.restartConfirm'),
      variant: 'default',
      onSuccess: () => void restartWithModel(),
    });
  };

  const saveDefault = async () => {
    if (!selectedModel || !runtimeSettings || !canSaveDefault) return;
    const next: RuntimeCustomConfig = { ...runtimeSettings, defaultModel: selectedModel };
    if (codexParameters) {
      next.defaultReasoningEffort = selectedReasoningEffort;
      next.defaultFastMode = selectedFastMode;
    }
    try {
      await updateAsync(next);
      setSavedDefaults({
        model: selectedModel,
        ...(codexParameters
          ? { reasoningEffort: selectedReasoningEffort, fastMode: selectedFastMode }
          : {}),
      });
      toast.success(
        t(
          codexParameters
            ? 'workspaceRuntime.model.defaultSuccessWithParameters'
            : 'workspaceRuntime.model.defaultSuccess',
          { model: selectedModel }
        )
      );
    } catch (error) {
      toast.error(t('workspaceRuntime.model.defaultFailed'), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div
      className="mb-2 overflow-hidden rounded-md border border-border bg-background-secondary/35"
      data-testid="session-model-editor"
    >
      <div className="px-2.5 pb-2 pt-2.5">
        <div className="min-w-0">
          <div className="text-xs font-medium text-foreground">
            {t('workspaceRuntime.model.title')}
          </div>
          <div className="mt-0.5 text-[10px] text-foreground-passive">{currentModelSource}</div>
        </div>
      </div>

      <div className="border-t border-border px-2.5 py-2.5">
        <Combobox
          items={groups}
          value={selectedOption}
          onValueChange={(option: ModelOption | null) => setSelectedOption(option)}
          isItemEqualToValue={(left: ModelOption, right: ModelOption) => left.key === right.key}
          filter={(option: ModelOption, query) => {
            const needle = query.trim().toLowerCase();
            if (!needle) return true;
            return `${option.providerName} ${option.catalogModelId} ${option.runtimeModelId}`
              .toLowerCase()
              .includes(needle);
          }}
          autoHighlight
        >
          <ComboboxTrigger
            aria-label={t('workspaceRuntime.model.choose')}
            className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-left text-xs outline-none transition-colors hover:bg-background-2 focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span className="min-w-0 flex-1 truncate font-mono">
              {selectedModel || t('workspaceRuntime.model.choose')}
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-foreground-passive" />
          </ComboboxTrigger>
          <ComboboxContent className="w-[min(24rem,var(--available-width))]">
            <ComboboxInput
              showTrigger={false}
              placeholder={t('workspaceRuntime.model.searchPlaceholder')}
              onKeyDownCapture={(event) => {
                if (event.key === 'Enter' && isImeComposing(event)) event.stopPropagation();
              }}
            />
            <ComboboxEmpty>
              {catalogQuery.isLoading
                ? t('workspaceRuntime.model.loading')
                : catalogQuery.isError
                  ? t('workspaceRuntime.model.loadFailed')
                  : t('workspaceRuntime.model.empty')}
            </ComboboxEmpty>
            <ComboboxList>
              {(group: ModelOptionGroup) => (
                <ComboboxGroup key={group.value} items={group.items}>
                  <ComboboxLabel>{group.label}</ComboboxLabel>
                  <ComboboxCollection>
                    {(option: ModelOption) => (
                      <ComboboxItem key={option.key} value={option} className="text-xs">
                        <span className="min-w-0 flex-1 truncate font-mono">
                          {option.runtimeModelId}
                        </span>
                        {option.sources.includes('custom') ? (
                          <span className="shrink-0 text-[10px] text-foreground-passive">
                            {t('settings.models.customBadge')}
                          </span>
                        ) : null}
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                </ComboboxGroup>
              )}
            </ComboboxList>
            <div className="border-t border-border p-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start text-xs"
                onClick={onManageModels}
              >
                <ExternalLink className="size-3.5" />
                {t('workspaceRuntime.model.manage')}
              </Button>
            </div>
          </ComboboxContent>
        </Combobox>

        {codexParameters ? (
          <div className="mt-2 divide-y divide-border overflow-hidden rounded-md border border-border bg-background/60">
            <div className="flex min-h-10 items-center justify-between gap-3 px-2.5 py-1.5">
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-foreground">
                  {t('workspaceRuntime.model.reasoningLabel')}
                </div>
                <div className="truncate text-[10px] text-foreground-passive">
                  {t('workspaceRuntime.model.reasoningDescription')}
                </div>
              </div>
              <Select
                value={selectedReasoningEffort}
                onValueChange={(value) => value && setSelectedReasoningEffort(value)}
                disabled={busy}
              >
                <SelectTrigger
                  size="sm"
                  aria-label={t('workspaceRuntime.model.reasoningLabel')}
                  className="h-7 w-28 shrink-0 bg-background font-mono text-[11px]"
                >
                  <SelectValue>
                    {() => formatReasoningEffort(selectedReasoningEffort, (key) => t(key))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  {reasoningEffortOptions(selectedReasoningEffort).map((effort) => (
                    <SelectItem key={effort} value={effort} className="text-xs">
                      {formatReasoningEffort(effort, (key) => t(key))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex min-h-10 items-center justify-between gap-3 px-2.5 py-1.5">
              <label
                htmlFor={fastModeControlId}
                className="min-w-0 cursor-pointer"
                data-testid="session-model-fast-mode-label"
              >
                <span className="block text-[11px] font-medium text-foreground">
                  {t('workspaceRuntime.model.fastMode')}
                </span>
                <span className="block truncate text-[10px] text-foreground-passive">
                  {t('workspaceRuntime.model.fastModeDescription')}
                </span>
              </label>
              <Switch
                id={fastModeControlId}
                size="sm"
                checked={selectedFastMode}
                onCheckedChange={setSelectedFastMode}
                disabled={busy}
                aria-label={t('workspaceRuntime.model.fastMode')}
              />
            </div>
          </div>
        ) : null}

        <div className="mt-2 grid min-w-0 grid-cols-1 gap-1 text-[10px] text-foreground-passive">
          <span className="block w-full min-w-0 max-w-full truncate">
            {t('workspaceRuntime.model.provider', {
              provider: provider?.name ?? t('workspaceRuntime.model.unknownProvider'),
            })}
          </span>
          <span className="block w-full min-w-0 max-w-full truncate font-mono">
            {t('workspaceRuntime.model.defaultModel', {
              model: defaultModel || t('agents.runtimeInfo.clientDefault'),
            })}
          </span>
          {codexParameters ? (
            <span className="block w-full min-w-0 max-w-full truncate">
              {t('workspaceRuntime.model.defaultParameters', {
                effort: defaultReasoningEffort ?? t('workspaceRuntime.model.inheritClientDefault'),
                speed:
                  defaultFastMode === undefined
                    ? t('workspaceRuntime.model.inheritClientDefault')
                    : t(
                        defaultFastMode
                          ? 'workspaceRuntime.model.fastSpeed'
                          : 'workspaceRuntime.model.standardSpeed'
                      ),
              })}
            </span>
          ) : null}
        </div>

        <div className="mt-2.5 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            className="min-w-36 flex-1"
            onClick={confirmRestart}
            disabled={!canRestart}
          >
            <RotateCcw className="size-3.5" />
            {isRestarting
              ? t('workspaceRuntime.model.restarting')
              : t('workspaceRuntime.model.restartCurrent')}
          </Button>
          {allowDefaultChange ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-w-36 flex-1"
              onClick={() => void saveDefault()}
              disabled={!canSaveDefault}
            >
              <Save className="size-3.5" />
              {t('workspaceRuntime.model.setDefault')}
            </Button>
          ) : null}
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-foreground-passive">
          {allowDefaultChange
            ? t('workspaceRuntime.model.applyHint')
            : t('workspaceRuntime.model.remoteHint')}
        </p>
      </div>
    </div>
  );
}

export function buildModelOptionGroups(
  providers: readonly ModelProviderCatalogGroup[]
): ModelOptionGroup[] {
  return providers
    .map((provider) => ({
      value: provider.id,
      label: provider.name,
      items: provider.models.map((model) => ({
        key: `${provider.id}:${model.id}`,
        providerId: provider.id,
        providerName: provider.name,
        catalogModelId: model.id,
        runtimeModelId: toRuntimeModelId(provider.id, model.id),
        sources: model.sources,
      })),
    }))
    .filter((group) => group.items.length > 0);
}

function findModelOption(options: readonly ModelOption[], model: string): ModelOption | null {
  if (!model) return null;
  return (
    options.find((option) => option.runtimeModelId === model || option.catalogModelId === model) ??
    null
  );
}

function reasoningEffortOptions(current: string): string[] {
  return CODEX_REASONING_EFFORTS.includes(current as (typeof CODEX_REASONING_EFFORTS)[number])
    ? [...CODEX_REASONING_EFFORTS]
    : [current, ...CODEX_REASONING_EFFORTS];
}

function formatReasoningEffort(effort: string, translate: (key: string) => string): string {
  return CODEX_REASONING_EFFORTS.includes(effort as (typeof CODEX_REASONING_EFFORTS)[number])
    ? translate(`workspaceRuntime.model.reasoning.${effort}`)
    : effort;
}
