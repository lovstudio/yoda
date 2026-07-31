import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Ellipsis, Loader2, Power, PowerOff, RefreshCw, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RuntimeCustomConfigs } from '@shared/app-settings';
import type { DependencyState } from '@shared/dependencies';
import { isValidRuntimeId, RUNTIMES, type RuntimeId } from '@shared/runtime-registry';
import {
  getAgentInstallErrorMessage,
  getAgentUninstallErrorMessage,
} from '@renderer/lib/components/agent-selector/agent-install';
import { AgentInstallButton } from '@renderer/lib/components/agent-selector/agent-install-button';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { workspaceTerminalStore } from '@renderer/lib/stores/workspace-terminal-store';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { cn } from '@renderer/utils/utils';
import { AgentDetailPanel } from './AgentDetailPanel';
import { RuntimeLogo } from './RuntimeLogo';

type RuntimeRow = {
  id: RuntimeId;
  name: string;
  detected: boolean;
  version: string | null;
  installCommand: string | null;
  disabled: boolean;
  canUpdate: boolean;
  canUninstall: boolean;
};

/**
 * Detectable runtimes, connected ones first, then alphabetical. This is the
 * single list that replaces the old flat "Runtimes" roster *and* the nested
 * 480px master-detail — collapsed rows carry install status, expanding reveals
 * the full per-runtime detail inline.
 */
function buildRows(
  statuses: Record<string, DependencyState>,
  configs: RuntimeCustomConfigs
): RuntimeRow[] {
  return RUNTIMES.filter((runtime) => runtime.detectable !== false)
    .map<RuntimeRow>((runtime) => {
      const dep = statuses[runtime.id];
      return {
        id: runtime.id,
        name: runtime.name,
        detected: dep?.status === 'available',
        version: dep?.version ?? null,
        installCommand: runtime.installCommand ?? null,
        disabled: configs[runtime.id]?.disabled === true,
        canUpdate: Boolean(runtime.updateCommand),
        canUninstall: Boolean(runtime.uninstallCommand),
      };
    })
    .sort((a, b) => {
      if (a.detected !== b.detected) return a.detected ? -1 : 1;
      if (a.disabled !== b.disabled) return a.disabled ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
}

export const RuntimeAccordion: React.FC<{ focusRuntimeId?: RuntimeId }> = observer(
  function RuntimeAccordion({ focusRuntimeId }) {
    const { t } = useTranslation();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const showConfirm = useShowModal('confirmActionModal');
    const statuses = appState.dependencies.agentStatuses;
    const { data: runtimeConfigs = {} } = useQuery<RuntimeCustomConfigs>({
      queryKey: ['runtimeSettings', 'all'] as const,
      queryFn: () => rpc.runtimeSettings.getAll() as Promise<RuntimeCustomConfigs>,
      staleTime: 60_000,
    });
    const rows = useMemo(() => buildRows(statuses, runtimeConfigs), [statuses, runtimeConfigs]);
    const defaultOpen = useMemo(() => rows.find((row) => row.detected)?.id ?? rows[0]?.id, [rows]);
    const [openRuntimeId, setOpenRuntimeId] = useState<RuntimeId | null>(
      () => focusRuntimeId ?? defaultOpen ?? null
    );

    useEffect(() => {
      if (focusRuntimeId) setOpenRuntimeId(focusRuntimeId);
    }, [focusRuntimeId]);

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

    const handleUpdate = useCallback(async (row: RuntimeRow) => {
      await workspaceTerminalStore.runRuntimeAction(row.id, 'update').catch(() => {});
    }, []);

    const setCachedDisabled = useCallback(
      (runtimeId: RuntimeId, disabled: boolean) => {
        queryClient.setQueryData<RuntimeCustomConfigs>(
          ['runtimeSettings', 'all'],
          (current = {}) => ({
            ...current,
            [runtimeId]: { ...current[runtimeId], disabled },
          })
        );
      },
      [queryClient]
    );

    const handleSetDisabled = useCallback(
      async (row: RuntimeRow, disabled: boolean) => {
        setCachedDisabled(row.id, disabled);
        try {
          await rpc.runtimeSettings.updateItem(row.id, { disabled });
          if (disabled) {
            await (async () => {
              const defaultRuntime = await rpc.appSettings.get('defaultRuntime');
              const fallback = rows.find(
                (candidate) => candidate.id !== row.id && candidate.detected && !candidate.disabled
              );
              if (defaultRuntime === row.id && fallback) {
                await rpc.appSettings.update('defaultRuntime', fallback.id);
                void queryClient.invalidateQueries({ queryKey: ['appSettings'] });
              }
            })().catch(() => {
              void queryClient.invalidateQueries({ queryKey: ['appSettings'] });
            });
          }
          toast({
            title: t(
              disabled ? 'agents.runtimeInfo.disableSuccess' : 'agents.runtimeInfo.enableSuccess',
              { name: row.name }
            ),
          });
        } catch (error) {
          setCachedDisabled(row.id, row.disabled);
          toast({
            title: t('agents.runtimeInfo.stateChangeFailed'),
            description: error instanceof Error ? error.message : String(error),
            variant: 'destructive',
          });
        } finally {
          void queryClient.invalidateQueries({ queryKey: ['runtimeSettings', row.id] });
          void queryClient.invalidateQueries({ queryKey: ['runtimeSettings', 'all'] });
        }
      },
      [queryClient, rows, setCachedDisabled, t, toast]
    );

    const performUninstall = useCallback(
      async (row: RuntimeRow) => {
        const result = await appState.dependencies.uninstall(row.id);
        if (!result.success) {
          toast({
            title: t('agents.runtimeInfo.uninstallFailed'),
            description: getAgentUninstallErrorMessage(result.error),
            variant: 'destructive',
          });
          return;
        }

        await rpc.runtimeSettings.updateItem(row.id, { disabled: false }).catch(() => {});
        setCachedDisabled(row.id, false);
        toast({
          title: t('agents.runtimeInfo.uninstallSuccess'),
          description: t('agents.runtimeInfo.uninstallSuccessDescription', { name: row.name }),
        });
      },
      [setCachedDisabled, t, toast]
    );

    const handleUninstall = useCallback(
      (row: RuntimeRow) => {
        showConfirm({
          title: t('agents.runtimeInfo.uninstallTitle', { name: row.name }),
          description: t('agents.runtimeInfo.uninstallDescription', { name: row.name }),
          confirmLabel: t('agents.runtimeInfo.uninstall'),
          onSuccess: () => void performUninstall(row),
        });
      },
      [performUninstall, showConfirm, t]
    );

    return (
      <AccordionPrimitive.Root
        type="single"
        collapsible
        value={openRuntimeId ?? ''}
        onValueChange={(value) => setOpenRuntimeId(isValidRuntimeId(value) ? value : null)}
        className="overflow-hidden rounded-xl border border-border/60 bg-muted/10"
      >
        {rows.map((row) => (
          <RuntimeAccordionItem
            key={row.id}
            row={row}
            onInstall={handleInstall}
            onUpdate={handleUpdate}
            onSetDisabled={handleSetDisabled}
            onUninstall={handleUninstall}
          />
        ))}
      </AccordionPrimitive.Root>
    );
  }
);

const RuntimeAccordionItem: React.FC<{
  row: RuntimeRow;
  onInstall: (row: RuntimeRow) => void;
  onUpdate: (row: RuntimeRow) => void;
  onSetDisabled: (row: RuntimeRow, disabled: boolean) => void;
  onUninstall: (row: RuntimeRow) => void;
}> = observer(function RuntimeAccordionItem({
  row,
  onInstall,
  onUpdate,
  onSetDisabled,
  onUninstall,
}) {
  const { t } = useTranslation();
  const installing = appState.dependencies.isInstalling(row.id);
  const statusLabel = row.disabled
    ? t('agents.runtimeInfo.disabled')
    : row.detected
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
              row.disabled
                ? 'bg-amber-500'
                : row.detected
                  ? 'bg-emerald-500'
                  : 'bg-muted-foreground/40'
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
        ) : row.detected ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              type="button"
              title={t('agents.runtimeInfo.actions')}
              aria-label={t('agents.runtimeInfo.actions')}
              disabled={installing}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              {installing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Ellipsis className="size-3.5" />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {row.canUpdate && (
                <DropdownMenuItem onClick={() => void onUpdate(row)}>
                  <RefreshCw className="size-3.5" />
                  {t('agents.runtimeInfo.update')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => void onSetDisabled(row, !row.disabled)}>
                {row.disabled ? <Power className="size-3.5" /> : <PowerOff className="size-3.5" />}
                {t(row.disabled ? 'agents.runtimeInfo.enable' : 'agents.runtimeInfo.disable')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                disabled={!row.canUninstall}
                title={row.canUninstall ? undefined : t('agents.runtimeInfo.uninstallUnavailable')}
                onClick={() => onUninstall(row)}
              >
                <Trash2 className="size-3.5" />
                {t('agents.runtimeInfo.uninstall')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
        <div className="border-t border-border/50 bg-background">
          <AgentDetailPanel agentId={row.id} hideHeader />
        </div>
      </AccordionPrimitive.Content>
    </AccordionPrimitive.Item>
  );
});
