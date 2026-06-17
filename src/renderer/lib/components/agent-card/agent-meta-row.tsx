import { useTranslation } from 'react-i18next';
import { getRuntime, type RuntimeId } from '@shared/runtime-registry';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';

interface AgentMetaRowProps {
  /** The runtime that actually runs (slot override or the Agent's preferred). */
  runtime: RuntimeId | null;
  /** Model hint; pass a string (incl. a "default" label) to show it, omit to hide. */
  model?: string | null;
  skillCount?: number;
  className?: string;
}

/**
 * The quiet metadata line under an Agent's name — runtime, optional model, and
 * skill count — rendered identically wherever an Agent is shown.
 */
export function AgentMetaRow({ runtime, model, skillCount = 0, className }: AgentMetaRowProps) {
  const { t } = useTranslation();
  const config = runtime ? agentConfig[runtime] : null;
  const runtimeName = runtime
    ? (getRuntime(runtime)?.name ?? runtime)
    : t('agentManager.anyRuntime');

  return (
    <span
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-[11px] text-foreground-muted',
        className
      )}
    >
      {config && (
        <AgentLogo
          logo={config.logo}
          alt={config.alt}
          isSvg={config.isSvg}
          invertInDark={config.invertInDark}
          className="h-3 w-3 shrink-0 rounded-sm"
        />
      )}
      <span className="truncate">{runtimeName}</span>
      {model && (
        <>
          <span className="text-foreground-passive">·</span>
          <span className="min-w-0 shrink-0 truncate">{model}</span>
        </>
      )}
      {skillCount > 0 && (
        <>
          <span className="text-foreground-passive">·</span>
          <span className="shrink-0">{t('agentManager.skillsCount', { count: skillCount })}</span>
        </>
      )}
    </span>
  );
}
