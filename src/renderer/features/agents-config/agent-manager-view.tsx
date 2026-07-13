import { Copy, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState, type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import type { Agent } from '@shared/agents';
import { builtinAgentI18nKey } from '@shared/builtin-agents';
import { AgentCard as AgentIdentityCard } from '@renderer/lib/components/agent-card/agent-card';
import { AgentMetaRow } from '@renderer/lib/components/agent-card/agent-meta-row';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { cn } from '@renderer/utils/utils';
import { useAgents } from './use-agents';

function AgentCard({
  agent,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  agent: Agent;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { t, i18n } = useTranslation();

  // Built-in Agents are seeded with English name/description; show their
  // localized copy when a translation exists. User-authored Agents (and any
  // built-in the user has renamed away from the preset wording) fall through
  // to the stored value, shown verbatim — user content is never translated.
  const i18nKey = builtinAgentI18nKey(agent.slug);
  const name = i18nKey && i18n.exists(`${i18nKey}.name`) ? t(`${i18nKey}.name`) : agent.name;
  const description =
    i18nKey && i18n.exists(`${i18nKey}.description`)
      ? t(`${i18nKey}.description`)
      : agent.description;

  return (
    <AgentIdentityCard
      name={name}
      icon={agent.icon}
      description={description || t('agentManager.noDescription')}
      footer={
        <AgentMetaRow
          className="mt-0.5"
          runtime={agent.preferredRuntime}
          model={agent.model || t('agentManager.modelDefault')}
          skillCount={agent.enabledSkillIds.length + agent.manualSkillIds.length}
        />
      }
      trailing={
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            aria-label={t('common.edit')}
            onClick={onEdit}
            className="flex size-7 items-center justify-center rounded-md text-foreground-muted hover:bg-background-2 hover:text-foreground"
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={t('agentManager.duplicate')}
            onClick={onDuplicate}
            className="flex size-7 items-center justify-center rounded-md text-foreground-muted hover:bg-background-2 hover:text-foreground"
          >
            <Copy className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={t('common.delete')}
            onClick={onDelete}
            className="flex size-7 items-center justify-center rounded-md text-foreground-muted hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      }
    />
  );
}

export function AgentManagerView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();
  const { agents, isLoading, remove, duplicate } = useAgents();
  const showAgentModal = useShowModal('agentEditModal');
  const showConfirm = useShowModal('confirmActionModal');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return agents;
    return agents.filter(
      (a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)
    );
  }, [agents, query]);

  const handleDelete = (agent: Agent) =>
    showConfirm({
      title: t('agentManager.deleteTitle'),
      description: t('agentManager.deleteDescription', { name: agent.name }),
      confirmLabel: t('common.delete'),
      onSuccess: () => void remove(agent.id),
    });

  return (
    <div
      className={cn(
        '@container flex w-full flex-col min-h-0',
        !embedded && 'mx-auto h-full max-w-4xl px-6 pt-6'
      )}
    >
      <div className="flex shrink-0 flex-col gap-3 border-b border-border pb-4">
        <div
          className={cn('flex items-center gap-2', embedded ? 'justify-end' : 'justify-between')}
        >
          {!embedded && (
            <div>
              <h1 className="text-lg font-semibold text-foreground">{t('agentManager.title')}</h1>
              <p className="text-xs text-foreground-muted">{t('agentManager.subtitle')}</p>
            </div>
          )}
          <Button size="sm" onClick={() => showAgentModal({})}>
            <Plus className="size-4" />
            {t('agentManager.newAgent')}
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-foreground-muted" />
          <Input
            placeholder={t('agentManager.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 pl-8 text-sm"
          />
        </div>
      </div>

      <div className={cn('py-4', !embedded && 'flex-1 overflow-y-auto')}>
        {isLoading ? (
          <p className="text-sm text-foreground-muted">{t('common.loading')}</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <span className="text-3xl">🤖</span>
            <p className="text-sm text-foreground-muted">
              {agents.length === 0 ? t('agentManager.empty') : t('agentManager.noResults')}
            </p>
            {agents.length === 0 && (
              <Button size="sm" variant="outline" onClick={() => showAgentModal({})}>
                <Plus className="size-4" />
                {t('agentManager.createFirst')}
              </Button>
            )}
          </div>
        ) : (
          <div className={cn('grid gap-3 @2xl:grid-cols-2')}>
            {filtered.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onEdit={() => showAgentModal({ agent })}
                onDuplicate={() => duplicate(agent.id)}
                onDelete={() => handleDelete(agent)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function AgentManagerTitlebar() {
  return <Titlebar />;
}

export function AgentManagerWrapView({ children }: PropsWithChildren) {
  return <>{children}</>;
}

export function AgentManagerMainPanel() {
  return <AgentManagerView />;
}

export const agentManagerView = {
  WrapView: AgentManagerWrapView,
  TitlebarSlot: AgentManagerTitlebar,
  MainPanel: AgentManagerMainPanel,
};
