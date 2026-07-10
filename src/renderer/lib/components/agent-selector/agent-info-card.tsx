import {
  ArrowUpRight,
  Check,
  Copy,
  RefreshCw,
  Settings2,
  Stethoscope,
  Terminal,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DependencyState } from '@shared/dependencies';
import { resolveRuntimePaths } from '@shared/runtime-paths';
import {
  getDescriptionForRuntime,
  getDocUrlForRuntime,
  getInstallCommandForRuntime,
  getRuntime,
  type RuntimeId,
} from '@shared/runtime-registry';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { rpc } from '@renderer/lib/ipc';
import { appState } from '@renderer/lib/stores/app-state';
import { workspaceShellStore } from '@renderer/lib/stores/workspace-shell-store';
import { Button } from '@renderer/lib/ui/button';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import { useRuntimeSnapshot } from './use-runtime-snapshot';

type Props = {
  id: RuntimeId;
  dependency?: DependencyState;
  selectedModel?: string | null;
  connectionId?: string;
};

export const AgentInfoCard: React.FC<Props> = ({ id, dependency, selectedModel, connectionId }) => {
  const { t } = useTranslation();
  const runtime = getRuntime(id);
  const config = agentConfig[id];
  const description = getDescriptionForRuntime(id);
  const installCommand = getInstallCommandForRuntime(id);
  const docUrl = getDocUrlForRuntime(id);
  const title = runtime?.name ?? id;
  const snapshotQuery = useRuntimeSnapshot(id, connectionId);
  const snapshot = snapshotQuery.data;
  const installation = dependency ?? snapshot?.installation ?? null;
  const installed = installation?.status === 'available';
  const model =
    selectedModel?.trim() ||
    snapshot?.model.defaultModel ||
    snapshot?.model.nativeModel ||
    t('agents.runtimeInfo.clientDefault');
  const modelSource = selectedModel?.trim()
    ? t('agents.runtimeInfo.agentOverride')
    : snapshot?.model.defaultModel
      ? t('agents.runtimeInfo.yodaDefault')
      : snapshot?.model.nativeModel
        ? t('agents.runtimeInfo.cliConfig')
        : t('agents.runtimeInfo.cliDefault');
  const canonicalPaths = resolveRuntimePaths(id);
  const configPath = connectionId
    ? (snapshot?.config.path ?? null)
    : (snapshot?.config.path ?? canonicalPaths.settings ?? canonicalPaths.config ?? null);
  const [copied, setCopied] = useState(false);
  const copyResetRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current);
    };
  }, []);

  const copyInstallCommand = async () => {
    if (!installCommand || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(installCommand);
      setCopied(true);
      if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current);
      copyResetRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const refresh = async () => {
    await appState.dependencies.refreshAgents(connectionId);
    await snapshotQuery.refetch();
  };

  const manage = () => {
    if (connectionId) return;
    appState.sidePane.pinView('settings', { tab: 'clis-models', runtimeId: id });
  };

  return (
    <div className="w-96 max-w-[24rem] rounded-lg border border-border bg-background p-3 text-foreground shadow-md">
      <div className="mb-2 flex items-start gap-2">
        <AgentLogo
          logo={config.logo}
          alt={config.alt}
          isSvg={config.isSvg}
          invertInDark={config.invertInDark}
          className="h-6 w-6 shrink-0 rounded-sm"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <strong className="truncate text-sm font-medium">{title}</strong>
            <RuntimeStateBadge dependency={installation} loading={snapshotQuery.isLoading} />
            {snapshot?.update.available ? (
              <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                {t('agents.runtimeInfo.updateAvailable', {
                  version: snapshot.update.latestVersion,
                })}
              </span>
            ) : null}
          </div>
          {description ? (
            <p className="mt-1 text-xs leading-relaxed text-foreground-muted">{description}</p>
          ) : null}
        </div>
      </div>

      <div className="mb-2 divide-y divide-border overflow-hidden rounded-md border border-border">
        <InfoRow
          label={t('agents.runtimeInfo.version')}
          value={installation?.version ? `v${installation.version}` : t('agents.notDetected')}
          detail={
            snapshot?.update.latestVersion
              ? t('agents.runtimeInfo.latestVersion', { version: snapshot.update.latestVersion })
              : undefined
          }
        />
        <InfoRow label={t('agents.runtimeInfo.model')} value={model} detail={modelSource} mono />
        <InfoRow
          label={t('agents.runtimeInfo.executable')}
          value={installation?.path ?? t('agents.unset')}
          mono
        />
        <InfoRow
          label={t('agents.runtimeInfo.config')}
          value={configPath ?? t('agents.unset')}
          detail={
            snapshot?.config.exists === false
              ? t('agents.runtimeInfo.configMissing')
              : snapshot?.config.exists
                ? t('agents.runtimeInfo.configDetected')
                : undefined
          }
          mono
        />
        {snapshot?.config.authProvider ? (
          <InfoRow
            label={t('agents.runtimeInfo.auth')}
            value={t(`agents.runtimeInfo.authProviders.${snapshot.config.authProvider}`)}
          />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {installed && !connectionId ? (
          <>
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                void workspaceShellStore.runRuntimeAction(id, 'open').catch(() => {});
              }}
            >
              <Terminal className="size-3.5" />
              {t('agents.runtimeInfo.openCli')}
            </Button>
            {snapshot?.update.command ? (
              <Button
                variant={snapshot.update.available ? 'default' : 'outline'}
                size="xs"
                onClick={() => {
                  void workspaceShellStore.runRuntimeAction(id, 'update').catch(() => {});
                }}
              >
                <RefreshCw className="size-3.5" />
                {t('agents.runtimeInfo.update')}
              </Button>
            ) : null}
            {id === 'codex' ? (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  void workspaceShellStore.runRuntimeAction(id, 'doctor').catch(() => {});
                }}
              >
                <Stethoscope className="size-3.5" />
                {t('agents.runtimeInfo.doctor')}
              </Button>
            ) : null}
          </>
        ) : null}
        <Button
          variant="ghost"
          size="icon-xs"
          title={t('agents.runtimeInfo.refresh')}
          disabled={snapshotQuery.isFetching}
          onClick={() => void refresh()}
        >
          <RefreshCw className={cn('size-3.5', snapshotQuery.isFetching && 'animate-spin')} />
        </Button>
        {!connectionId ? (
          <Button
            variant="ghost"
            size="icon-xs"
            title={t('agents.runtimeInfo.manage')}
            onClick={manage}
          >
            <Settings2 className="size-3.5" />
          </Button>
        ) : null}
        {docUrl ? (
          <Button
            variant="ghost"
            size="icon-xs"
            title={t('agents.docs')}
            onClick={() => void rpc.app.openExternal(docUrl)}
          >
            <ArrowUpRight className="size-3.5" />
          </Button>
        ) : null}
      </div>

      {!installed && installCommand ? (
        <div className="mt-2 flex h-8 items-center justify-between rounded-md border border-border px-2 text-xs">
          <code className="truncate font-mono">{installCommand}</code>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => void copyInstallCommand()}
            title={copied ? t('common.copied') : t('agents.copyCommand')}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </Button>
        </div>
      ) : null}
    </div>
  );
};

function RuntimeStateBadge({
  dependency,
  loading,
}: {
  dependency: DependencyState | null;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const available = dependency?.status === 'available';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]',
        available
          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
          : 'bg-muted/40 text-muted-foreground'
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          available ? 'bg-emerald-500' : 'bg-muted-foreground/50'
        )}
      />
      {loading && !dependency
        ? t('common.loading')
        : available
          ? t('agents.detected')
          : t('agents.notDetected')}
    </span>
  );
}

function InfoRow({
  label,
  value,
  detail,
  mono,
}: {
  label: string;
  value: string;
  detail?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-2.5 py-1.5 text-xs">
      <span className="w-16 shrink-0 text-foreground-muted">{label}</span>
      <span className={cn('min-w-0 flex-1 truncate text-right', mono && 'font-mono')} title={value}>
        {value}
      </span>
      {detail ? (
        <span className="max-w-24 shrink-0 truncate text-[10px] text-foreground-passive">
          {detail}
        </span>
      ) : null}
    </div>
  );
}
