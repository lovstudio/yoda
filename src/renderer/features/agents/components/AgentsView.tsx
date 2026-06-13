import { observer } from 'mobx-react-lite';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DependencyState } from '@shared/dependencies';
import { RUNTIMES, type RuntimeId } from '@shared/runtime-registry';
import { appState } from '@renderer/lib/stores/app-state';
import { cn } from '@renderer/utils/utils';
import { AgentDetailPanel } from './AgentDetailPanel';
import { RuntimeLogo } from './RuntimeLogo';

type AgentRow = {
  id: RuntimeId;
  name: string;
  detected: boolean;
  version: string | null;
};

function buildRows(agentStatuses: Record<string, DependencyState>): AgentRow[] {
  return RUNTIMES.map<AgentRow>((provider) => {
    const dep = agentStatuses[provider.id];
    return {
      id: provider.id,
      name: provider.name,
      detected: dep?.status === 'available',
      version: dep?.version ?? null,
    };
  }).sort((a, b) => {
    if (a.detected && !b.detected) return -1;
    if (b.detected && !a.detected) return 1;
    return a.name.localeCompare(b.name);
  });
}

export const AgentsView: React.FC<{ embedded?: boolean }> = observer(function AgentsView({
  embedded = false,
}) {
  const { t } = useTranslation();
  const agentStatuses = appState.dependencies.agentStatuses;
  const rows = useMemo(() => buildRows(agentStatuses), [agentStatuses]);

  const [selectedId, setSelectedId] = useState<RuntimeId>(
    () => rows.find((r) => r.detected)?.id ?? rows[0]?.id ?? 'claude'
  );

  return (
    <div
      className={cn(
        'flex overflow-hidden bg-background text-foreground',
        embedded ? 'h-[480px] rounded-xl border border-border' : 'h-full'
      )}
    >
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-background-tertiary">
        {!embedded && (
          <div className="px-4 py-4 border-b border-border">
            <h1 className="text-sm font-semibold">{t('agents.title')}</h1>
            <p className="mt-1 text-xs text-muted-foreground">{t('agents.subtitle')}</p>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-2">
          {rows.map((row) => (
            <AgentListItem
              key={row.id}
              row={row}
              isActive={row.id === selectedId}
              onSelect={() => setSelectedId(row.id)}
            />
          ))}
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <AgentDetailPanel agentId={selectedId} />
      </main>
    </div>
  );
});

const AgentListItem: React.FC<{
  row: AgentRow;
  isActive: boolean;
  onSelect: () => void;
}> = ({ row, isActive, onSelect }) => {
  const { t } = useTranslation();
  const connected = row.detected;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition',
        isActive ? 'bg-accent/40 text-foreground' : 'text-foreground-muted hover:bg-muted/30'
      )}
    >
      <RuntimeLogo runtimeId={row.id} name={row.name} className="h-6 w-6" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm">{row.name}</span>
        <span className="truncate text-[10px] text-muted-foreground">
          {connected
            ? row.version
              ? `v${row.version}`
              : t('agents.detected')
            : t('agents.notDetected')}
        </span>
      </span>
      <span
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          connected ? 'bg-emerald-500' : 'bg-muted-foreground/40'
        )}
      />
    </button>
  );
};
