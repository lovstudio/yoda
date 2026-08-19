import { ChevronDown } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocalStorage } from '@renderer/lib/hooks/useLocalStorage';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@renderer/lib/ui/combobox';
import { InputGroupButton } from '@renderer/lib/ui/input-group';
import { isImeComposing } from '@renderer/utils/ime';

const SUFFIX_LRU_KEY = 'yoda.agent-model-suffix.recent';
const SUFFIX_LRU_MAX = 8;

export type AgentModelSuffixComboboxProps = {
  id?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  className?: string;
  contentClassName?: string;
};

/**
 * Suffix companion to `AgentModelCombobox`. Holds a free-form suffix (e.g.
 * `[1m]`) appended verbatim to the model id at launch — decoupled from the
 * model list so a suffixed variant doesn't need its own catalog entry.
 * Remembers recently-used suffixes in localStorage (LRU, most-recent first).
 */
export function AgentModelSuffixCombobox({
  id,
  value,
  onChange,
  className,
  contentClassName = 'w-56',
}: AgentModelSuffixComboboxProps) {
  const { t } = useTranslation();
  const [recent, setRecent] = useLocalStorage<string[]>(SUFFIX_LRU_KEY, []);
  const [open, setOpen] = useState(false);
  const isSelectingOption = useRef(false);

  const options = useMemo(
    () => recent.filter((suffix) => suffix?.trim()).slice(0, SUFFIX_LRU_MAX),
    [recent]
  );
  const selectedOption = useMemo(() => {
    const candidate = value?.trim();
    return candidate ? (options.find((suffix) => suffix === candidate) ?? null) : null;
  }, [options, value]);

  const commit = (suffix: string) => {
    const trimmed = suffix.trim();
    if (!trimmed) {
      onChange(null);
      return;
    }
    onChange(trimmed);
    setRecent((prev) =>
      [trimmed, ...prev.filter((existing) => existing !== trimmed)].slice(0, SUFFIX_LRU_MAX)
    );
  };

  return (
    <Combobox
      items={options}
      value={selectedOption}
      inputValue={value ?? ''}
      open={open}
      onOpenChange={setOpen}
      onInputValueChange={(next, { reason }: { reason: string }) => {
        if (reason === 'input-change') onChange(next || null);
      }}
      onValueChange={(suffix: string | null) => {
        if (!suffix) return;
        commit(suffix);
        setOpen(false);
        setTimeout(() => {
          isSelectingOption.current = false;
        }, 0);
      }}
      itemToStringLabel={(suffix: string) => suffix}
      itemToStringValue={(suffix: string) => suffix}
      isItemEqualToValue={(left: string, right: string) => left === right}
      filter={(suffix: string, query) => suffix.toLowerCase().includes(query.trim().toLowerCase())}
      autoHighlight
    >
      <ComboboxInput
        id={id}
        placeholder={t('agentManager.modelSuffixPlaceholder')}
        aria-label={t('agentManager.modelSuffix')}
        className={className}
        showTrigger={false}
        rightAddon={
          <InputGroupButton
            size="icon-xs"
            variant="ghost"
            render={<ComboboxTrigger />}
            aria-label={t('agentManager.modelSuffixCandidates')}
          >
            <ChevronDown className="size-3.5" />
          </InputGroupButton>
        }
        onBlur={(event) => {
          if (isSelectingOption.current) {
            isSelectingOption.current = false;
            return;
          }
          commit(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          if (isImeComposing(event)) {
            event.stopPropagation();
            return;
          }
          commit(event.currentTarget.value);
          event.currentTarget.blur();
        }}
      />
      <ComboboxContent className={contentClassName}>
        <ComboboxEmpty>{t('agentManager.modelSuffixEmpty')}</ComboboxEmpty>
        <ComboboxList>
          {(suffix: string) => (
            <ComboboxItem
              key={suffix}
              value={suffix}
              className="text-xs"
              onPointerDownCapture={() => {
                isSelectingOption.current = true;
              }}
            >
              <span className="min-w-0 flex-1 truncate font-mono">{suffix}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
