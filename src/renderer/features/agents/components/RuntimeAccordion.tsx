import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDown } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { DependencyState } from '@shared/dependencies';
import { isValidRuntimeId, RUNTIMES, type RuntimeId } from '@shared/runtime-registry';
import { getAgentInstallErrorMessage } from '@renderer/lib/components/agent-selector/agent-install';
import { AgentInstallButton } from '@renderer/lib/components/agent-selector/agent-install-button';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { appState } from '@renderer/lib/stores/app-state';
import { cn } from '@renderer/utils/utils';
import { AgentDetailPanel } from './AgentDetailPanel';
import { RuntimeLogo } from './RuntimeLogo';

type RuntimeRow = {
  id: RuntimeId;
  name: string;
  detected: boolean;
  version: string | null;
  installCommand: string | null;
};

/**
 * Detectable runtimes, connected ones first, then alphabetical. This is the
 * single list that replaces the old flat "Runtimes" roster *and* the nested
 * 480px master-detail — collapsed rows carry install status, expanding reveals
 * the full per-runtime detail inline.
 */
function buildRows(statuses: Record<string, DependencyState>): RuntimeRow[] {
  return RUNTIMES.filter((runtime) => runtime.detectable !== false)
    .map<RuntimeRow>((runtime) => {
      const dep = statuses[runtime.id];
      return {
        id: runtime.id,
        name: runtime.name,
        detected: dep?.status === 'available',
        version: dep?.version ?? null,
        installCommand: runtime.installCommand ?? null,
      };
    })
    .sort((a, b) => {
      if (a.detected !== b.detected) return a.detected ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export const RuntimeAccordion: React.FC = observer(function RuntimeAccordion() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const statuses = appState.dependencies.agentStatuses;
  const rows = useMemo(() => buildRows(statuses), [statuses]);
  const defaultOpen = useMemo(() => rows.find((row) => row.detected)?.id ?? rows[0]?.id, [rows]);

  const handleInstall = useCallback(
    async (row: RuntimeRow) => {
      if (!isValidRuntimeId(row.id) || appState.dependencies.isInstalling(row.id)) return;

      const result = await appState.dependencies.install(row.id);
      if (result.success) {
        toast({
          title: t('settings.agentsTab.agentInstalled'),
          description: t('settings.agentsTab.agentInstalledDescription', { name: row.name }),
        });
        return;
      }
      toast({
        title: t('settings.agentsTab.installFailed'),
        description: getAgentInstallErrorMessage(result.error),
        variant: 'destructive',
      });
    },
    [toast, t]
  );

  return (
    <AccordionPrimitive.Root
      type="single"
      collapsible
      defaultValue={defaultOpen}
      className="overflow-hidden rounded-xl border border-border/60 bg-muted/10"
    >
      {rows.map((row) => (
        <RuntimeAccordionItem key={row.id} row={row} onInstall={handleInstall} />
      ))}
    </AccordionPrimitive.Root>
  );
});

const RuntimeAccordionItem: React.FC<{
  row: RuntimeRow;
  onInstall: (row: RuntimeRow) => void;
}> = observer(function RuntimeAccordionItem({ row, onInstall }) {
  const { t } = useTranslation();
  const installing = appState.dependencies.isInstalling(row.id);
  const statusLabel = row.detected
    ? row.version
      ? `v${row.version}`
      : t('settings.agentsTab.detected')
    : t('settings.agentsTab.notDetected');

  return (
    <AccordionPrimitive.Item
      value={row.id}
      className="border-b border-border/50 transition-colors last:border-b-0 data-[state=open]:bg-background-1/40"
    >
      <AccordionPrimitive.Header className="flex items-center gap-1 pr-2.5">
        <AccordionPrimitive.Trigger className="group flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/30 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border">
          <ChevronDown
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-200 group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
          <RuntimeLogo runtimeId={row.id} name={row.name} className="h-6 w-6" />
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{row.name}</span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{statusLabel}</span>
          <span
            className={cn(
              'h-1.5 w-1.5 shrink-0 rounded-full',
              row.detected ? 'bg-emerald-500' : 'bg-muted-foreground/40'
            )}
          />
        </AccordionPrimitive.Trigger>
        {/* Install lives outside the trigger — a button can't nest in a button. */}
        {!row.detected && isValidRuntimeId(row.id) ? (
          <AgentInstallButton
            agentId={row.id}
            canInstall={!!row.installCommand}
            isInstalled={row.detected}
            isInstalling={installing}
            tooltipSide="top"
            onInstall={() => onInstall(row)}
          />
        ) : null}
      </AccordionPrimitive.Header>
      <AccordionPrimitive.Content
        className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
        style={
          {
            '--accordion-panel-height': 'var(--radix-accordion-content-height)',
          } as React.CSSProperties
        }
      >
        <div className="h-[26rem] border-t border-border/50 bg-background">
          <AgentDetailPanel agentId={row.id} hideHeader />
        </div>
      </AccordionPrimitive.Content>
    </AccordionPrimitive.Item>
  );
});
