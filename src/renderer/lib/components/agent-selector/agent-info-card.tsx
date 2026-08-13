import {
  ArrowUpRight,
  Check,
  Copy,
  History,
  MoreHorizontal,
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
  getVersionHistoryUrlForRuntime,
  type RuntimeId,
} from '@shared/runtime-registry';
import AgentLogo from '@renderer/lib/components/agent-logo';
import {
  FilePathActionsDropdown,
  type FilePathTarget,
} from '@renderer/lib/components/file-path-actions';
import { rpc } from '@renderer/lib/ipc';
import { appState } from '@renderer/lib/stores/app-state';
import { workspaceTerminalStore } from '@renderer/lib/stores/workspace-terminal-store';
import { Button } from '@renderer/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import { SessionModelEditor, type SessionModelSettings } from './session-model-editor';
import { useRuntimeSnapshot } from './use-runtime-snapshot';

type Props = {
  id: RuntimeId;
  dependency?: DependencyState;
  selectedModel?: string | null;
  selectedModelSource?: 'agentOverride' | 'currentSession';
  connectionId?: string;
  authPresentation?: {
    value: string;
    detail?: string;
  };
  modelEditing?: {
    reasoningEffort?: string | null;
    fastMode?: boolean | null;
    onRestartWithModel: (settings: SessionModelSettings) => Promise<void>;
    onManageModels: () => void;
    allowDefaultChange: boolean;
  };
};

export const AgentInfoCard: React.FC<Props> = ({
  id,
  dependency,
  selectedModel,
  selectedModelSource = 'agentOverride',
  connectionId,
  authPresentation,
  modelEditing,
}) => {
  const { t } = useTranslation();
  const runtime = getRuntime(id);
  const config = agentConfig[id];
  const description = getDescriptionForRuntime(id);
  const installCommand = getInstallCommandForRuntime(id);
  const docUrl = getDocUrlForRuntime(id);
  const versionHistoryUrl = getVersionHistoryUrlForRuntime(id);
  const title = runtime?.name ?? id;
  const snapshotQuery = useRuntimeSnapshot(id, connectionId);
  const snapshot = snapshotQuery.data;
  const installation = dependency ?? snapshot?.installation ?? null;
  const installed = installation?.status === 'available';
  const resolvedModel =
    selectedModel?.trim() || snapshot?.model.defaultModel || snapshot?.model.nativeModel || null;
  const model = resolvedModel ?? t('agents.runtimeInfo.clientDefault');
  const modelSource = selectedModel?.trim()
    ? t(`agents.runtimeInfo.${selectedModelSource}`)
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
    <div className="w-[min(24rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] rounded-lg border border-border bg-background p-3 text-foreground shadow-md">
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
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                className="-mr-1 -mt-1 shrink-0"
                title={t('common.more')}
                aria-label={t('common.more')}
                data-testid="agent-info-actions-menu"
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-48">
            {installed && !connectionId && snapshot?.update.command ? (
              <DropdownMenuItem
                onClick={() => {
                  void workspaceTerminalStore.runRuntimeAction(id, 'update').catch(() => {});
                }}
              >
                <RefreshCw />
                {t('agents.runtimeInfo.update')}
              </DropdownMenuItem>
            ) : null}
            {id === 'codex' && installed && !connectionId ? (
              <DropdownMenuItem
                onClick={() => {
                  void workspaceTerminalStore.runRuntimeAction(id, 'doctor').catch(() => {});
                }}
              >
                <Stethoscope />
                {t('agents.runtimeInfo.doctor')}
              </DropdownMenuItem>
            ) : null}
            {!connectionId ? (
              <DropdownMenuItem onClick={manage}>
                <Settings2 />
                {t('agents.runtimeInfo.manage')}
              </DropdownMenuItem>
            ) : null}
            {docUrl ? (
              <DropdownMenuItem onClick={() => void rpc.app.openExternal(docUrl)}>
                <ArrowUpRight />
                {t('agents.docs')}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={snapshotQuery.isFetching} onClick={() => void refresh()}>
              <RefreshCw className={cn(snapshotQuery.isFetching && 'animate-spin')} />
              {t('agents.runtimeInfo.refresh')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {modelEditing ? (
        <SessionModelEditor
          runtimeId={id}
          currentModel={resolvedModel}
          currentModelSource={modelSource}
          reasoningEffort={modelEditing.reasoningEffort}
          fastMode={modelEditing.fastMode}
          onRestartWithModel={modelEditing.onRestartWithModel}
          onManageModels={modelEditing.onManageModels}
          allowDefaultChange={modelEditing.allowDefaultChange}
        />
      ) : null}

      <div className="mb-2 divide-y divide-border overflow-hidden rounded-md border border-border">
        <InfoRow
          label={t('agents.runtimeInfo.version')}
          value={installation?.version ? `v${installation.version}` : t('agents.notDetected')}
          trailingAction={
            <VersionInfoDropdown
              latestVersion={snapshot?.update.latestVersion ?? null}
              historyUrl={versionHistoryUrl}
            />
          }
        />
        {!modelEditing ? (
          <InfoRow label={t('agents.runtimeInfo.model')} value={model} detail={modelSource} mono />
        ) : null}
        <InfoRow
          label={t('agents.runtimeInfo.executable')}
          value={installation?.path ?? t('agents.unset')}
          mono
          pathTarget={
            installation?.path
              ? { absolutePath: installation.path, kind: 'file', sshConnectionId: connectionId }
              : undefined
          }
          pathActions={
            installed && !connectionId ? (
              <DropdownMenuItem
                onClick={() => {
                  void workspaceTerminalStore.runRuntimeAction(id, 'open').catch(() => {});
                }}
              >
                <Terminal />
                {t('agents.runtimeInfo.openCli')}
              </DropdownMenuItem>
            ) : undefined
          }
        />
        <InfoRow
          label={t('agents.runtimeInfo.config')}
          value={configPath ?? t('agents.unset')}
          mono
          pathTarget={
            configPath
              ? { absolutePath: configPath, kind: 'file', sshConnectionId: connectionId }
              : undefined
          }
        />
        {authPresentation ? (
          <InfoRow
            label={t('agents.runtimeInfo.auth')}
            value={authPresentation.value}
            detail={authPresentation.detail}
          />
        ) : snapshot?.config.authProvider ? (
          <InfoRow
            label={t('agents.runtimeInfo.auth')}
            value={t(`agents.runtimeInfo.authProviders.${snapshot.config.authProvider}`)}
          />
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

function VersionInfoDropdown({
  latestVersion,
  historyUrl,
}: {
  latestVersion: string | null;
  historyUrl: string | null;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex size-5 shrink-0 items-center justify-center rounded-sm text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
            title={t('agents.runtimeInfo.versionMenu')}
            aria-label={t('agents.runtimeInfo.versionMenu')}
            data-testid="runtime-version-menu"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between gap-4 font-normal">
            <span>{t('agents.runtimeInfo.latestVersionLabel')}</span>
            <span className="font-mono text-foreground">
              {latestVersion ? `v${latestVersion}` : '—'}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        {historyUrl ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void rpc.app.openExternal(historyUrl)}>
              <History />
              {t('agents.runtimeInfo.versionHistory')}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function InfoRow({
  label,
  value,
  detail,
  mono,
  pathTarget,
  pathActions,
  trailingAction,
}: {
  label: string;
  value: string;
  detail?: string;
  mono?: boolean;
  pathTarget?: FilePathTarget;
  pathActions?: React.ReactNode;
  trailingAction?: React.ReactNode;
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
      {trailingAction}
      {pathTarget ? (
        <FilePathActionsDropdown target={pathTarget} className="shrink-0">
          {pathActions}
        </FilePathActionsDropdown>
      ) : null}
    </div>
  );
}
