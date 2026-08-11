import { ChevronDown } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  toRuntimeModelId,
  type ModelProviderCatalogGroup,
  type ModelProviderCatalogSource,
} from '@shared/model-provider-catalog';
import { useModelProviderCatalog } from '@renderer/features/settings/model-provider-catalog-query';
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
import { InputGroupButton } from '@renderer/lib/ui/input-group';
import { isImeComposing } from '@renderer/utils/ime';

type AgentModelOption = {
  key: string;
  providerId: string;
  providerName: string;
  modelId: string;
  value: string;
  sources: ModelProviderCatalogSource[];
};

type AgentModelGroup = {
  value: string;
  label: string;
  items: AgentModelOption[];
};

export type AgentModelComboboxProps = {
  id?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  /** Called immediately after choosing a catalog option. */
  onSelect?: (value: string) => void;
  /** Called when manually entered text leaves the field. */
  onBlur?: (value: string | null) => void;
  /** Called for Enter when the suggestion list is closed. */
  onSubmit?: (value: string | null) => void;
  className?: string;
  contentClassName?: string;
};

/**
 * Shared Agent model control. Both the profile editor and the launch composer
 * use the same catalog, custom-model input, and IME behavior.
 */
export function AgentModelCombobox({
  id,
  value,
  onChange,
  onSelect,
  onBlur,
  onSubmit,
  className,
  contentClassName = 'w-[min(24rem,var(--available-width))]',
}: AgentModelComboboxProps) {
  const { t } = useTranslation();
  const modelCatalog = useModelProviderCatalog();
  const [open, setOpen] = useState(false);
  const isSelectingOption = useRef(false);
  const groups = useMemo(
    () => buildAgentModelGroups(modelCatalog.data?.providers ?? []),
    [modelCatalog.data]
  );
  const options = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const selectedOption = useMemo(() => {
    const candidate = value?.trim();
    if (!candidate) return null;
    return (
      options.find((option) => option.value === candidate || option.modelId === candidate) ?? null
    );
  }, [options, value]);

  const commitSelectedOption = (option: AgentModelOption | null) => {
    if (!option) return;
    onChange(option.value);
    onSelect?.(option.value);
    setOpen(false);
    setTimeout(() => {
      isSelectingOption.current = false;
    }, 0);
  };

  return (
    <Combobox
      items={groups}
      value={selectedOption}
      inputValue={value ?? ''}
      open={open}
      onOpenChange={setOpen}
      onInputValueChange={(next, { reason }: { reason: string }) => {
        if (reason === 'input-change') onChange(next || null);
      }}
      onValueChange={commitSelectedOption}
      itemToStringLabel={(option: AgentModelOption) => option.value}
      itemToStringValue={(option: AgentModelOption) => option.key}
      isItemEqualToValue={(left: AgentModelOption, right: AgentModelOption) =>
        left.key === right.key
      }
      filter={(option: AgentModelOption, query) =>
        `${option.providerName} ${option.modelId} ${option.value}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())
      }
      autoHighlight
    >
      <ComboboxInput
        id={id}
        placeholder={t('agentManager.modelPlaceholder')}
        aria-label={t('agentManager.model')}
        className={className}
        showTrigger={false}
        rightAddon={
          <InputGroupButton
            size="icon-xs"
            variant="ghost"
            render={<ComboboxTrigger />}
            aria-label={t('agentManager.modelCandidates')}
          >
            <ChevronDown className="size-3.5" />
          </InputGroupButton>
        }
        onBlur={(event) => {
          if (isSelectingOption.current) {
            isSelectingOption.current = false;
            return;
          }
          onBlur?.(event.currentTarget.value || null);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          if (isImeComposing(event)) {
            event.stopPropagation();
            return;
          }
          if (!open && onSubmit) {
            onSubmit(event.currentTarget.value || null);
            event.currentTarget.blur();
          }
        }}
      />
      <ComboboxContent className={contentClassName}>
        <ComboboxEmpty>
          {modelCatalog.isLoading ? t('common.loading') : t('agentManager.modelCustomHint')}
        </ComboboxEmpty>
        <ComboboxList>
          {(group: AgentModelGroup) => (
            <ComboboxGroup key={group.value} items={group.items}>
              <ComboboxLabel>{group.label}</ComboboxLabel>
              <ComboboxCollection>
                {(option: AgentModelOption) => (
                  <ComboboxItem
                    key={option.key}
                    value={option}
                    className="text-xs"
                    onPointerDownCapture={() => {
                      isSelectingOption.current = true;
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono">{option.value}</span>
                    {option.sources.includes('custom') ? (
                      <span className="text-[10px] text-muted-foreground">
                        {t('agentManager.modelCustom')}
                      </span>
                    ) : null}
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

function buildAgentModelGroups(providers: readonly ModelProviderCatalogGroup[]): AgentModelGroup[] {
  return providers
    .map((provider) => ({
      value: provider.id,
      label: provider.name,
      items: provider.models.map((model) => ({
        key: `${provider.id}:${model.id}`,
        providerId: provider.id,
        providerName: provider.name,
        modelId: model.id,
        value: toRuntimeModelId(provider.id, model.id),
        sources: model.sources,
      })),
    }))
    .filter((group) => group.items.length > 0);
}
