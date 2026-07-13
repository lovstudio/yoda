import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Agent } from '@shared/agents';
import { getRuntime } from '@shared/runtime-registry';
import { useSkills } from '@renderer/features/skills/components/useSkills';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { agentConfig } from '@renderer/utils/agentConfig';

/**
 * Hover/detail card for an **Agent** (the Prompt + Skills + preferred client
 * entity). Mirrors the runtime/client info card so the two pickers feel
 * consistent: header, runtime + model, system prompt preview, and skills.
 */
export const AgentInfoCard: React.FC<{ agent: Agent }> = ({ agent }) => {
  const { t } = useTranslation();
  const { installedSkills } = useSkills();

  const runtimeConfig = agent.preferredRuntime ? agentConfig[agent.preferredRuntime] : null;
  const runtimeName = agent.preferredRuntime
    ? (getRuntime(agent.preferredRuntime)?.name ?? agent.preferredRuntime)
    : t('agentManager.anyRuntime');

  const resolveSkillName = (identifier: string) =>
    installedSkills.find((skill) => skill.key === identifier || skill.id === identifier)
      ?.displayName ?? identifier;
  const skillNames = [
    ...agent.enabledSkillIds.map((identifier) => resolveSkillName(identifier)),
    ...agent.manualSkillIds.map(
      (identifier) => `${resolveSkillName(identifier)} · ${t('agentManager.skillModeManual')}`
    ),
  ];

  return (
    <div className="w-80 max-w-[20rem] rounded-lg border border-border bg-background p-3 text-foreground shadow-md">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center text-[15px] leading-none">
          {agent.icon || '🤖'}
        </span>
        <strong className="min-w-0 flex-1 truncate text-sm font-medium leading-none">
          {agent.name}
        </strong>
      </div>

      <p className="mb-2 text-xs leading-relaxed text-foreground-muted">
        {agent.description || t('agentManager.noDescription')}
      </p>

      <div className="mb-2 flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs">
        {runtimeConfig ? (
          <AgentLogo
            logo={runtimeConfig.logo}
            alt={runtimeConfig.alt}
            isSvg={runtimeConfig.isSvg}
            invertInDark={runtimeConfig.invertInDark}
            className="h-4 w-4 shrink-0 rounded-sm"
          />
        ) : null}
        <span className="min-w-0 flex-1 truncate text-foreground">{runtimeName}</span>
        <span className="shrink-0 text-foreground-muted">
          {agent.model ?? t('agentManager.modelDefault')}
        </span>
      </div>

      <div className="mb-2">
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-foreground-muted">
          {t('agentManager.systemPrompt')}
        </div>
        {agent.systemPrompt ? (
          <p className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background-1 p-2 text-xs leading-relaxed text-foreground-muted">
            {agent.systemPrompt}
          </p>
        ) : (
          <p className="text-xs text-foreground-passive">{t('agentManager.noSystemPrompt')}</p>
        )}
      </div>

      <div>
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-foreground-muted">
          {t('agentManager.skills')}
        </div>
        {skillNames.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {skillNames.map((name, index) => (
              <span
                key={`${name}-${index}`}
                className="max-w-40 truncate rounded-sm border border-border bg-background-1 px-1.5 py-0.5 text-[11px] text-foreground-muted"
              >
                {name}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-foreground-passive">{t('agentManager.noEnabledSkills')}</p>
        )}
      </div>
    </div>
  );
};

interface AgentInfoHoverProps {
  agent: Agent;
  children: React.ReactElement;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
}

/** Wraps a row/trigger so hovering surfaces the Agent's full detail card. */
export const AgentInfoHover: React.FC<AgentInfoHoverProps> = ({
  agent,
  children,
  side = 'right',
  align = 'start',
}) => {
  return (
    <Popover>
      <PopoverTrigger openOnHover nativeButton={false} delay={0} closeDelay={0} render={children} />
      <PopoverContent
        side={side}
        align={align}
        sideOffset={8}
        className="w-auto border border-border bg-background p-0 text-foreground shadow-lg"
      >
        <AgentInfoCard agent={agent} />
      </PopoverContent>
    </Popover>
  );
};
