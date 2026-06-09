import { Check, ChevronDown, Plus, Settings2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AGENT_PROVIDER_IDS, type AgentProviderId } from '@shared/agent-provider-registry';
import type { Agent } from '@shared/agents';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { useAgentAvailability } from '@renderer/lib/components/agent-selector/use-agent-availability';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';

/**
 * What a slot currently points at: either a user-defined Agent (which carries
 * its own system prompt + preferred runtime + skills) or a bare runtime.
 */
export type AgentSlotSelection =
  | { kind: 'agent'; agentId: string }
  | { kind: 'provider'; provider: AgentProviderId };

interface AgentSlotSelectorProps {
  selection: AgentSlotSelection;
  agents: Agent[];
  onSelectAgent: (agentId: string) => void;
  onSelectProvider: (provider: AgentProviderId) => void;
  onCreateAgent: () => void;
  onManageAgents: () => void;
  connectionId?: string;
  className?: string;
}

/**
 * The unified "Agent Store" picker every run-mode slot uses. The trigger shows
 * the current selection (user Agent or bare runtime); the popover lists user
 * Agents on top, installed runtimes below, and new/manage shortcuts at the
 * bottom. This replaces both the old per-card runtime dropdown and the separate
 * AgentCardPicker, so every mode's slot behaves identically.
 */
export const AgentSlotSelector = observer(function AgentSlotSelector({
  selection,
  agents,
  onSelectAgent,
  onSelectProvider,
  onCreateAgent,
  onManageAgents,
  connectionId,
  className,
}: AgentSlotSelectorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { groups } = useAgentAvailability({ connectionId, value: null });

  const installedProviderIds = useMemo(() => {
    const installed = new Set<AgentProviderId>();
    for (const group of groups) {
      for (const item of group.items) {
        if (!item.disabled) installed.add(item.agentId);
      }
    }
    return AGENT_PROVIDER_IDS.filter((id) => installed.has(id));
  }, [groups]);

  const selectedAgent =
    selection.kind === 'agent' ? agents.find((a) => a.id === selection.agentId) : undefined;
  const selectedProvider = selection.kind === 'provider' ? selection.provider : undefined;
  const selectedConfig = selectedProvider ? agentConfig[selectedProvider] : null;

  const q = query.trim().toLowerCase();
  const filteredAgents = q
    ? agents.filter(
        (a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)
      )
    : agents;
  const filteredProviders = q
    ? installedProviderIds.filter((id) => agentConfig[id].name.toLowerCase().includes(q))
    : installedProviderIds;

  const pickAgent = (agentId: string) => {
    onSelectAgent(agentId);
    setOpen(false);
  };
  const pickProvider = (provider: AgentProviderId) => {
    onSelectProvider(provider);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setQuery('');
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              'flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-border bg-transparent px-2.5 py-1 text-sm outline-none transition-colors hover:bg-background-2',
              className
            )}
          >
            {selectedAgent ? (
              <>
                <span className="flex size-4 shrink-0 items-center justify-center text-[13px] leading-none">
                  {selectedAgent.icon || '🤖'}
                </span>
                <span className="flex-1 truncate text-left">{selectedAgent.name}</span>
              </>
            ) : selectedConfig ? (
              <>
                <AgentLogo
                  logo={selectedConfig.logo}
                  alt={selectedConfig.alt}
                  isSvg={selectedConfig.isSvg}
                  invertInDark={selectedConfig.invertInDark}
                  className="h-4 w-4 shrink-0 rounded-sm"
                />
                <span className="flex-1 truncate text-left">{selectedConfig.name}</span>
              </>
            ) : (
              <span className="flex-1 truncate text-left text-foreground-muted">
                {t('agents.noAgentInstalled')}
              </span>
            )}
            <ChevronDown className="size-3.5 shrink-0 text-foreground-muted" />
          </button>
        }
      />
      <PopoverContent
        align="start"
        className="flex max-h-(--available-height) w-(--anchor-width) min-w-72 flex-col gap-0 overflow-hidden p-0"
      >
        <div className="border-b border-border/60 p-2">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('agents.searchAgents')}
            className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
          {filteredAgents.length > 0 && (
            <Section label={t('home.slotMyAgents')}>
              {filteredAgents.map((agent) => {
                const active = selection.kind === 'agent' && selection.agentId === agent.id;
                return (
                  <Row key={agent.id} active={active} onClick={() => pickAgent(agent.id)}>
                    <span className="flex size-4 shrink-0 items-center justify-center text-[13px] leading-none">
                      {agent.icon || '🤖'}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                    {active && <Check className="size-3.5 shrink-0 text-primary" />}
                  </Row>
                );
              })}
            </Section>
          )}
          {filteredProviders.length > 0 && (
            <Section label={t('home.slotRuntimes')}>
              {filteredProviders.map((id) => {
                const config = agentConfig[id];
                const active = selection.kind === 'provider' && selection.provider === id;
                return (
                  <Row key={id} active={active} onClick={() => pickProvider(id)}>
                    <AgentLogo
                      logo={config.logo}
                      alt={config.alt}
                      isSvg={config.isSvg}
                      invertInDark={config.invertInDark}
                      className="h-4 w-4 shrink-0 rounded-sm"
                    />
                    <span className="min-w-0 flex-1 truncate">{config.name}</span>
                    {active && <Check className="size-3.5 shrink-0 text-primary" />}
                  </Row>
                );
              })}
            </Section>
          )}
          {filteredAgents.length === 0 && filteredProviders.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-foreground-muted">
              {t('home.slotNoResults')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 border-t border-border/60 p-1">
          <ActionButton
            icon={Plus}
            label={t('home.slotNewAgent')}
            onClick={() => {
              setOpen(false);
              onCreateAgent();
            }}
          />
          <ActionButton
            icon={Settings2}
            label={t('home.slotManageAgents')}
            onClick={() => {
              setOpen(false);
              onManageAgents();
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
});

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-1">
      <p className="px-3 pb-1 text-[10px] font-medium uppercase tracking-wide text-foreground-muted">
        {label}
      </p>
      {children}
    </div>
  );
}

function Row({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
        active ? 'text-primary' : 'text-foreground hover:bg-background-2'
      )}
    >
      {children}
    </button>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-xs text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground"
    >
      <Icon className="size-3.5" />
      <span className="truncate">{label}</span>
    </button>
  );
}
