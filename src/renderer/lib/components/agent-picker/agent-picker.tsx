import { Check, ChevronDown, GitFork, Plus, Settings2 } from 'lucide-react';
import { useState, type ComponentType, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Agent } from '@shared/agents';
import { getRuntime } from '@shared/runtime-registry';
import { useAgents } from '@renderer/features/agents-config/use-agents';
import { AgentAvatar } from '@renderer/lib/components/agent-card/agent-avatar';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import { AgentInfoCard } from './agent-info-card';

interface AgentPickerProps {
  /** Currently selected Agent, or null when none is chosen yet. */
  selectedAgent: Agent | null;
  /** The Agents to offer. Callers may narrow the list (e.g. hide rostered ones). */
  agents: Agent[];
  /**
   * Receives the whole Agent, not an id: creating and forking hand back records
   * the caller's own list has not seen yet, and an id alone would force every
   * call site to wait for its query cache to catch up.
   */
  onSelect: (agent: Agent) => void;
  /** `sm` fits a settings row; `md` (default) fits a roster seat. */
  size?: 'sm' | 'md';
  /** Optional quiet line above the agent name inside the trigger (e.g. the
   *  slot's role), letting the caller fold a label into the picker row. */
  eyebrow?: ReactNode;
  /**
   * What the empty trigger reads as. Defaults to picking an Agent for a seat;
   * callers that use the empty state to *append* an Agent say so instead.
   */
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * The one way to choose an **Agent** anywhere in the app — roster seats, the
 * session AI utilities, anything later. An Agent is the entity that owns a system
 * prompt, skills and a preferred runtime, so the picker lists Agents only;
 * runtime is a field of an Agent, not a peer choice here.
 *
 * Creating is part of picking, not a detour: the popover carries search, a create
 * button, and a fork button per row, so a user who needs a variant of an existing
 * Agent gets it from here instead of leaving for the library.
 */
export function AgentPicker({
  selectedAgent,
  agents,
  onSelect,
  size = 'md',
  eyebrow,
  placeholder,
  disabled,
  className,
}: AgentPickerProps) {
  const { t } = useTranslation();
  const { duplicate } = useAgents();
  const { navigate } = useNavigate();
  const showAgentModal = useShowModal('agentEditModal');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<{ agent: Agent; anchor: HTMLElement } | null>(null);

  const compact = size === 'sm';
  const q = query.trim().toLowerCase();
  const filtered = q
    ? agents.filter(
        (a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)
      )
    : agents;

  const pick = (agent: Agent) => {
    onSelect(agent);
    setOpen(false);
  };

  const create = () => {
    setOpen(false);
    showAgentModal({ onSuccess: (created) => onSelect(created) });
  };

  /**
   * Fork = duplicate, then edit the copy. The copy is persisted before the editor
   * opens (as duplicating does in the library), and only a *saved* copy gets
   * selected — abandoning the editor must not seat a half-considered Agent.
   */
  const fork = async (agent: Agent) => {
    setOpen(false);
    const copy = await duplicate(agent.id);
    if (!copy) return;
    showAgentModal({ agent: copy, onSuccess: (saved) => onSelect(saved) });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery('');
        } else {
          setPreview(null);
        }
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            className={cn(
              'flex w-full min-w-0 items-center rounded-md border border-border bg-transparent px-2.5 py-1 text-sm outline-none transition-colors hover:bg-background-2 disabled:cursor-not-allowed disabled:opacity-60',
              compact ? 'h-8 gap-1.5' : 'h-9 gap-2.5',
              className
            )}
          >
            {selectedAgent ? (
              <>
                <AgentAvatar
                  name={selectedAgent.name}
                  icon={selectedAgent.icon}
                  className={compact ? 'size-5 rounded-md text-xs' : 'size-9 text-sm'}
                />
                <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
                  {eyebrow}
                  <span className={cn('truncate', !compact && 'text-[13px] font-medium')}>
                    {selectedAgent.name}
                  </span>
                </span>
              </>
            ) : (
              <>
                {compact ? (
                  <Plus className="size-3.5 shrink-0 text-foreground-passive" />
                ) : (
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-border-1 text-foreground-passive">
                    <Plus className="size-4" />
                  </span>
                )}
                <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
                  {eyebrow}
                  <span className="truncate text-foreground-muted">
                    {placeholder ?? t('home.slotPickAgent')}
                  </span>
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
        {/* Search and create sit on the same line: the two ways out of "none of
            these" belong where the looking happens, not in a separate footer. */}
        <div className="flex items-center gap-1 border-b border-border/60 p-2">
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPreview(null);
            }}
            placeholder={t('agents.searchAgents')}
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <IconAction icon={Plus} label={t('home.slotNewAgent')} onClick={create} />
          <IconAction
            icon={Settings2}
            label={t('home.slotManageAgents')}
            onClick={() => {
              setOpen(false);
              navigate('agentManager');
            }}
          />
        </div>
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
            filtered.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                active={selectedAgent?.id === agent.id}
                onPick={() => pick(agent)}
                onFork={() => void fork(agent)}
                onPreview={(anchor) =>
                  setPreview((current) => {
                    if (anchor) return { agent, anchor };
                    // Only this row may withdraw its own preview: a leave event
                    // arriving after the next row's enter must not blank it.
                    return current?.agent.id === agent.id ? null : current;
                  })
                }
              />
            ))
          )}
        </div>
        <Popover
          open={preview !== null}
          onOpenChange={(next) => {
            if (!next) setPreview(null);
          }}
        >
          {preview && (
            <PopoverContent
              anchor={preview.anchor}
              side="right"
              align="start"
              sideOffset={8}
              className="w-auto border border-border bg-background p-0 text-foreground shadow-lg"
            >
              <AgentInfoCard agent={preview.agent} />
            </PopoverContent>
          )}
        </Popover>
      </PopoverContent>
    </Popover>
  );
}

/**
 * One Agent as a row: choosing it and forking it are separate buttons inside one
 * hovered container, so the fork never steals a click meant for the selection —
 * and the container, not the button, anchors the details popover.
 */
function AgentRow({
  agent,
  active,
  onPick,
  onFork,
  onPreview,
}: {
  agent: Agent;
  active: boolean;
  onPick: () => void;
  onFork: () => void;
  onPreview: (anchor: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  const runtimeConfig = agent.preferredRuntime ? agentConfig[agent.preferredRuntime] : null;
  const runtimeName = agent.preferredRuntime
    ? (getRuntime(agent.preferredRuntime)?.name ?? agent.preferredRuntime)
    : t('agentManager.anyRuntime');
  const skillCount = agent.enabledSkillIds.length + agent.manualSkillIds.length;

  return (
    <div
      className="group/agent-row flex items-center gap-0.5 px-1.5"
      onPointerEnter={(event) => onPreview(event.currentTarget)}
      onPointerLeave={() => onPreview(null)}
      onFocus={(event) => onPreview(event.currentTarget)}
      onBlur={() => onPreview(null)}
    >
      <button
        type="button"
        onClick={onPick}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm transition-colors',
          active ? 'text-primary' : 'text-foreground group-hover/agent-row:bg-background-2'
        )}
      >
        <AgentAvatar
          name={agent.name}
          icon={agent.icon}
          className="size-7 self-start rounded-md text-xs"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate">{agent.name}</span>
          {agent.description && (
            <span className="truncate text-xs text-foreground-muted">{agent.description}</span>
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
            {skillCount > 0 && (
              <>
                <span className="text-foreground-passive">·</span>
                <span className="shrink-0">
                  {t('agentManager.skillsCount', { count: skillCount })}
                </span>
              </>
            )}
          </span>
        </span>
        {active && <Check className="size-3.5 shrink-0 self-start text-primary" />}
      </button>
      <button
        type="button"
        onClick={onFork}
        aria-label={t('agentManager.forkAgent')}
        title={t('agentManager.forkAgent')}
        className="flex size-7 shrink-0 items-center justify-center self-start rounded-md text-foreground-passive opacity-0 transition-opacity hover:bg-background-2 hover:text-foreground focus-visible:opacity-100 group-hover/agent-row:opacity-100"
      >
        <GitFork className="size-3.5" />
      </button>
    </div>
  );
}

function IconAction({
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
      aria-label={label}
      title={label}
      className="flex size-8 shrink-0 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground"
    >
      <Icon className="size-3.5" />
    </button>
  );
}
