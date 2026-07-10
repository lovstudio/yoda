import { ChevronDown } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RuntimeId } from '@shared/runtime-registry';
import AgentLogo from '@renderer/lib/components/agent-logo';
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxTrigger,
} from '@renderer/lib/ui/combobox';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import { AgentInstallButton } from './agent-install-button';
import {
  canInstallAgentOption,
  isComboboxOptionDisabled,
  type AgentGroup,
  type AgentOption,
} from './agent-selector-options';
import { AgentTooltipRow } from './agent-tooltip-row';
import { useAgentAvailability } from './use-agent-availability';

interface AgentSelectorProps {
  value: RuntimeId | null;
  onChange: (agent: RuntimeId) => void;
  disabled?: boolean;
  className?: string;
  connectionId?: string;
  installable?: boolean;
  autoFocus?: boolean;
  /** Agent/slot model override that will be passed to this runtime. */
  model?: string | null;
}

export const AgentSelector: React.FC<AgentSelectorProps> = observer(
  ({
    value,
    onChange,
    disabled = false,
    className = '',
    connectionId,
    installable = true,
    autoFocus = false,
    model,
  }) => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const { groups, dependencyData, installingAgents, installAgent } = useAgentAvailability({
      connectionId,
      value,
    });
    const allOptions = useMemo(() => groups.flatMap((group) => group.items), [groups]);

    const selectedConfig = value ? agentConfig[value] : null;
    const selectedOption = value ? allOptions.find((o) => o.value === value) : null;
    const selectedDependency = value ? dependencyData?.[value] : undefined;

    function handleValueChange(item: AgentOption | null) {
      if (!item || disabled || item.disabled) return;
      onChange(item.agentId);
      setOpen(false);
    }

    return (
      <Combobox
        items={groups}
        value={selectedOption ?? null}
        onValueChange={handleValueChange}
        open={open}
        onOpenChange={disabled ? undefined : setOpen}
        isItemEqualToValue={(a: AgentOption, b: AgentOption) => a.value === b.value}
        filter={(item: AgentOption, query) =>
          item.label.toLowerCase().includes(query.toLowerCase())
        }
        autoHighlight
      >
        <ComboboxTrigger
          data-autofocus={autoFocus || undefined}
          disabled={disabled}
          className={cn(
            'flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-border bg-transparent px-2.5 py-1 text-sm outline-none',
            disabled && 'cursor-not-allowed opacity-60',
            className
          )}
        >
          {selectedConfig ? (
            <>
              <AgentLogo
                logo={selectedConfig.logo}
                alt={selectedConfig.alt}
                isSvg={selectedConfig.isSvg}
                invertInDark={selectedConfig.invertInDark}
                className="h-4 w-4 shrink-0 rounded-sm"
              />
              <span className="flex-1 truncate text-left">{selectedConfig.name}</span>
              {selectedDependency?.version ? (
                <span className="shrink-0 text-[10px] tabular-nums text-foreground-muted">
                  v{selectedDependency.version}
                </span>
              ) : null}
            </>
          ) : (
            <span className="flex-1 truncate text-foreground-muted">
              {t('agents.noRuntimeInstalled')}
            </span>
          )}
          <ChevronDown className="size-3.5 shrink-0 text-foreground-muted" />
        </ComboboxTrigger>
        <ComboboxContent className="w-auto min-w-(--anchor-width)">
          <ComboboxInput showTrigger={false} placeholder={t('agents.searchRuntimes')} />
          <ComboboxList className="pb-0">
            {(group: AgentGroup) => (
              <ComboboxGroup key={group.value} items={group.items} className="py-1">
                <ComboboxLabel>{group.label}</ComboboxLabel>
                <ComboboxCollection>
                  {(item: AgentOption) => {
                    const config = agentConfig[item.agentId];
                    const dependency = dependencyData?.[item.agentId];
                    const showInstall = canInstallAgentOption(item, installable);
                    return (
                      <AgentTooltipRow
                        key={item.value}
                        id={item.agentId}
                        dependency={dependency}
                        model={model}
                        connectionId={connectionId}
                      >
                        <ComboboxItem
                          value={item}
                          disabled={isComboboxOptionDisabled(item)}
                          className={cn(
                            'group/agent-row',
                            item.disabled &&
                              'data-disabled:pointer-events-auto data-disabled:cursor-not-allowed',
                            showInstall && 'data-disabled:opacity-100'
                          )}
                        >
                          {config && (
                            <AgentLogo
                              logo={config.logo}
                              alt={config.alt}
                              isSvg={config.isSvg}
                              invertInDark={config.invertInDark}
                              className={cn(
                                'h-4 w-4 shrink-0 rounded-sm',
                                showInstall && 'opacity-50'
                              )}
                            />
                          )}
                          <span
                            className={cn(
                              'min-w-0 flex-1 truncate',
                              showInstall && 'text-foreground-muted'
                            )}
                          >
                            {item.label}
                          </span>
                          {dependency?.version ? (
                            <span className="shrink-0 text-[10px] tabular-nums text-foreground-muted">
                              v{dependency.version}
                            </span>
                          ) : null}
                          <AgentInstallButton
                            agentId={item.agentId}
                            canInstall={installable}
                            isInstalled={!item.disabled}
                            isInstalling={installingAgents.has(item.agentId)}
                            disabled={disabled}
                            className="size-6"
                            onInstall={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              if (disabled) return;
                              void installAgent(item.agentId);
                            }}
                          />
                        </ComboboxItem>
                      </AgentTooltipRow>
                    );
                  }}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    );
  }
);
