import { Check, ChevronDown, Plus, Settings2 } from 'lucide-react';
import {
  forwardRef,
  useState,
  type ButtonHTMLAttributes,
  type ComponentType,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { Agent } from '@shared/agents';
import { getRuntime } from '@shared/runtime-registry';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import { AgentInfoHover } from './agent-info-card';

interface AgentSlotSelectorProps {
  /** Currently selected Agent, or null when none is chosen yet. */
  selectedAgent: Agent | null;
  agents: Agent[];
  onSelectAgent: (agentId: string) => void;
  onCreateAgent: () => void;
  onManageAgents: () => void;
  /** Optional quiet line above the agent name inside the trigger (e.g. the
   *  slot's role), letting the caller fold a label into the picker row. */
  eyebrow?: ReactNode;
  className?: string;
}

/**
 * Monogram avatar for an Agent. We deliberately do not render the Agent's emoji
 * here — a brand-tinted initial reads as a real identity anchor and stays
 * consistent across light/dark themes, where stray emoji look out of place.
 */
function AgentAvatar({ name, className }: { name: string; className?: string }) {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? '·';
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 select-none items-center justify-center rounded-lg bg-primary-button-background font-semibold uppercase leading-none text-primary-button-foreground',
        className
      )}
    >
      {initial}
    </span>
  );
}

/**
 * Slot picker. A slot is an assignment of one **Agent** — the entity that owns a
 * system prompt, skills, and a preferred runtime. The picker therefore lists
 * Agents only; runtime is a field of an Agent, not a peer choice here. When no
 * Agents exist the only path forward is to create one.
 */
export function AgentSlotSelector({
  selectedAgent,
  agents,
  onSelectAgent,
  onCreateAgent,
  onManageAgents,
  eyebrow,
  className,
}: AgentSlotSelectorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const filtered = q
    ? agents.filter(
        (a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)
      )
    : agents;

  const pick = (agentId: string) => {
    onSelectAgent(agentId);
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
              'flex h-9 w-full min-w-0 items-center gap-2.5 rounded-md border border-border bg-transparent px-2.5 py-1 text-sm outline-none transition-colors hover:bg-background-2',
              className
            )}
          >
            {selectedAgent ? (
              <>
                <AgentAvatar name={selectedAgent.name} className="size-9 text-sm" />
                <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
                  {eyebrow}
                  <span className="truncate text-[13px] font-medium">{selectedAgent.name}</span>
                </span>
              </>
            ) : (
              <>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-border-1 text-foreground-passive">
                  <Plus className="size-4" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
                  {eyebrow}
                  <span className="truncate text-foreground-muted">{t('home.slotPickAgent')}</span>
                </span>
              </>
            )}
            <ChevronDown className="size-4 shrink-0 text-foreground-muted" />
          </button>
        }
      />
      <PopoverContent
        align="start"
        className="flex max-h-(--available-height) w-(--anchor-width) min-w-72 flex-col gap-0 overflow-hidden p-0"
      >
        {agents.length > 0 && (
          <div className="border-b border-border/60 p-2">
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('agents.searchAgents')}
              className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
          {agents.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-foreground-muted">
              {t('home.slotNoAgents')}
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-foreground-muted">
              {t('home.slotNoResults')}
            </p>
          ) : (
            filtered.map((agent) => {
              const active = selectedAgent?.id === agent.id;
              const runtimeConfig = agent.preferredRuntime
                ? agentConfig[agent.preferredRuntime]
                : null;
              const runtimeName = agent.preferredRuntime
                ? (getRuntime(agent.preferredRuntime)?.name ?? agent.preferredRuntime)
                : t('agentManager.anyRuntime');
              return (
                <AgentInfoHover key={agent.id} agent={agent}>
                  <Row active={active} onClick={() => pick(agent.id)}>
                    <AgentAvatar
                      name={agent.name}
                      className="size-7 self-start rounded-md text-xs"
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate">{agent.name}</span>
                      {agent.description && (
                        <span className="truncate text-xs text-foreground-muted">
                          {agent.description}
                        </span>
                      )}
                      <span className="flex items-center gap-1.5 text-[11px] text-foreground-muted">
                        {runtimeConfig ? (
                          <AgentLogo
                            logo={runtimeConfig.logo}
                            alt={runtimeConfig.alt}
                            isSvg={runtimeConfig.isSvg}
                            invertInDark={runtimeConfig.invertInDark}
                            className="h-3 w-3 shrink-0 rounded-sm"
                          />
                        ) : null}
                        <span className="truncate">{runtimeName}</span>
                        {agent.enabledSkillIds.length > 0 && (
                          <>
                            <span className="text-foreground-passive">·</span>
                            <span className="shrink-0">
                              {t('agentManager.skillsCount', {
                                count: agent.enabledSkillIds.length,
                              })}
                            </span>
                          </>
                        )}
                      </span>
                    </span>
                    {active && <Check className="size-3.5 shrink-0 self-start text-primary" />}
                  </Row>
                </AgentInfoHover>
              );
            })
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
}

// forwardRef + prop spreading so AgentInfoHover can use a Row as its hover
// trigger (base-ui clones the element and merges hover handlers + ref onto it).
const Row = forwardRef<
  HTMLButtonElement,
  {
    active: boolean;
    onClick: () => void;
    children: ReactNode;
  } & ButtonHTMLAttributes<HTMLButtonElement>
>(({ active, onClick, children, className, ...rest }, ref) => {
  return (
    <button
      {...rest}
      ref={ref}
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
        active ? 'text-primary' : 'text-foreground hover:bg-background-2',
        className
      )}
    >
      {children}
    </button>
  );
});
Row.displayName = 'Row';

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
