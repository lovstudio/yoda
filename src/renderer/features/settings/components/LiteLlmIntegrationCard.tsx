import {
  Download,
  ExternalLink,
  Loader2,
  Play,
  Power,
  RefreshCw,
  Settings2,
  Waypoints,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  LITELLM_DOCKER_DESKTOP_URL,
  LITELLM_MANAGED_ENDPOINT,
  type LiteLlmManagedOperation,
  type LiteLlmManagedState,
} from '@shared/litellm-managed';
import type { MaasConnection } from '@shared/maas';
import {
  useInstallLiteLlm,
  useLiteLlmManagedStatus,
  useMaasConnections,
  useOpenLiteLlmAdmin,
  useStartDockerForLiteLlm,
  useStartLiteLlm,
  useStopLiteLlm,
} from '@renderer/features/maas/useMaas';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';

type LiteLlmIntegrationCardProps = {
  onOpenManualSettings: () => void;
};

const operationActionKeys: Record<LiteLlmManagedOperation, string> = {
  installing: 'settings.integrationsTab.litellmInstalling',
  starting: 'settings.integrationsTab.litellmStarting',
  stopping: 'settings.integrationsTab.litellmStopping',
  'starting-docker': 'settings.integrationsTab.litellmStartingDocker',
};

const operationStatusKeys: Record<LiteLlmManagedOperation, string> = {
  installing: 'settings.integrationsTab.litellmStatusInstalling',
  starting: 'settings.integrationsTab.litellmStatusStarting',
  stopping: 'settings.integrationsTab.litellmStatusStopping',
  'starting-docker': 'settings.integrationsTab.litellmStatusDockerStarting',
};

function stateTone(state: LiteLlmManagedState | undefined): string {
  if (state === 'running' || state === 'external-running') return 'bg-emerald-500';
  if (state === 'stopped' || state === 'docker-stopped' || state === 'docker-starting') {
    return 'bg-amber-500';
  }
  return 'bg-muted-foreground/50';
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '');
}

export function LiteLlmIntegrationCard({ onOpenManualSettings }: LiteLlmIntegrationCardProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: connections } = useMaasConnections();
  const connection = connections?.find(
    (candidate: MaasConnection) => candidate.platformId === 'litellm'
  );
  const statusQuery = useLiteLlmManagedStatus();
  const install = useInstallLiteLlm();
  const start = useStartLiteLlm();
  const stop = useStopLiteLlm();
  const startDocker = useStartDockerForLiteLlm();
  const openAdmin = useOpenLiteLlmAdmin();

  const status = statusQuery.data;
  const operationPending =
    Boolean(status?.operation) ||
    install.isPending ||
    start.isPending ||
    stop.isPending ||
    startDocker.isPending ||
    openAdmin.isPending;
  const remoteConnection =
    connection?.connected &&
    normalizeEndpoint(connection.endpoint) !== normalizeEndpoint(LITELLM_MANAGED_ENDPOINT);

  const description = (() => {
    if (remoteConnection) {
      return t('settings.integrationsTab.litellmRemoteConnectedDescription', {
        endpoint: connection.endpoint,
      });
    }
    if (statusQuery.isLoading) return t('settings.integrationsTab.litellmDetecting');
    if (statusQuery.isError || !status) return t('settings.integrationsTab.litellmDetectionFailed');
    if (status.operation === 'installing') {
      return t('settings.integrationsTab.litellmInstallingDescription');
    }
    if (status.operation === 'starting') {
      return t('settings.integrationsTab.litellmStartingDescription');
    }
    if (status.operation === 'stopping') {
      return t('settings.integrationsTab.litellmStoppingDescription');
    }
    if (status.operation === 'starting-docker') {
      return t('settings.integrationsTab.litellmDockerStartingDescription');
    }

    switch (status.state) {
      case 'docker-missing':
        return t('settings.integrationsTab.litellmDockerMissingDescription');
      case 'docker-starting':
        return t('settings.integrationsTab.litellmDockerStartingDescription');
      case 'docker-stopped':
        return t('settings.integrationsTab.litellmDockerStoppedDescription');
      case 'not-installed':
        return t('settings.integrationsTab.litellmManagedDescription');
      case 'stopped':
        return t('settings.integrationsTab.litellmStoppedDescription');
      case 'external-running':
        return t('settings.integrationsTab.litellmExternalDescription');
      case 'running':
        return status.modelCount === 0
          ? t('settings.integrationsTab.litellmNeedsModelDescription')
          : status.modelCount === null
            ? t('settings.integrationsTab.litellmRunningDescription')
            : t('settings.integrationsTab.litellmReadyDescription', {
                count: status.modelCount,
              });
    }
  })();

  const statusLabel = remoteConnection
    ? t('settings.integrationsTab.litellmStatusRemote')
    : status?.operation
      ? t(operationStatusKeys[status.operation])
      : status?.state === 'running'
        ? status.modelCount === 0
          ? t('settings.integrationsTab.litellmStatusNeedsModel')
          : t('settings.integrationsTab.litellmStatusReady')
        : status?.state === 'external-running'
          ? t('settings.integrationsTab.litellmStatusDetected')
          : status?.state === 'stopped'
            ? t('settings.integrationsTab.litellmStatusStopped')
            : status?.state === 'docker-starting'
              ? t('settings.integrationsTab.litellmStatusDockerStarting')
              : status?.state === 'docker-stopped'
                ? t('settings.integrationsTab.litellmStatusDockerStopped')
                : t('settings.integrationsTab.litellmStatusNotInstalled');

  const runAction = async (
    action: () => Promise<unknown>,
    successTitle: string,
    errorTitle: string
  ) => {
    try {
      await action();
      toast({ title: successTitle });
    } catch (error) {
      toast({
        title: errorTitle,
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const handleOpenAdmin = async () => {
    try {
      await openAdmin.mutateAsync();
      toast({
        title: t('settings.integrationsTab.litellmAdminOpened'),
        description: t('settings.integrationsTab.litellmAdminCredentialsHint'),
      });
    } catch (error) {
      toast({
        title: t('settings.integrationsTab.litellmOpenAdminFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const renderActions = () => {
    if (remoteConnection) {
      return (
        <Button type="button" variant="outline" size="sm" onClick={onOpenManualSettings}>
          <Settings2 className="mr-1.5 h-4 w-4" />
          {t('settings.integrationsTab.litellmManageConnection')}
        </Button>
      );
    }

    if (statusQuery.isLoading || !status) {
      return (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={statusQuery.isLoading}
          onClick={() => void statusQuery.refetch()}
        >
          {statusQuery.isLoading ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-4 w-4" />
          )}
          {t('settings.integrationsTab.litellmRecheck')}
        </Button>
      );
    }

    if (status.operation) {
      return (
        <Button type="button" size="sm" disabled>
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          {t(operationActionKeys[status.operation])}
        </Button>
      );
    }

    if (status.state === 'docker-missing') {
      return (
        <>
          <Button
            type="button"
            size="sm"
            onClick={() => void rpc.app.openExternal(LITELLM_DOCKER_DESKTOP_URL)}
          >
            <Download className="mr-1.5 h-4 w-4" />
            {t('settings.integrationsTab.litellmDownloadDocker')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void statusQuery.refetch()}
          >
            <RefreshCw className="mr-1.5 h-4 w-4" />
            {t('settings.integrationsTab.litellmRecheck')}
          </Button>
        </>
      );
    }

    if (status.state === 'docker-stopped') {
      return (
        <>
          {status.canStartDocker && (
            <Button
              type="button"
              size="sm"
              disabled={operationPending}
              onClick={() =>
                void runAction(
                  () => startDocker.mutateAsync(),
                  t('settings.integrationsTab.litellmDockerStartRequested'),
                  t('settings.integrationsTab.litellmDockerStartFailed')
                )
              }
            >
              {startDocker.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-1.5 h-4 w-4" />
              )}
              {t('settings.integrationsTab.litellmStartDocker')}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void statusQuery.refetch()}
          >
            <RefreshCw className="mr-1.5 h-4 w-4" />
            {t('settings.integrationsTab.litellmRecheck')}
          </Button>
        </>
      );
    }

    if (status.state === 'docker-starting') {
      return (
        <>
          <Button type="button" size="sm" disabled>
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            {t('settings.integrationsTab.litellmStartingDocker')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void statusQuery.refetch()}
          >
            <RefreshCw className="mr-1.5 h-4 w-4" />
            {t('settings.integrationsTab.litellmRecheck')}
          </Button>
        </>
      );
    }

    if (status.state === 'not-installed') {
      return (
        <>
          <Button
            type="button"
            size="sm"
            disabled={operationPending}
            onClick={() =>
              void runAction(
                () => install.mutateAsync(),
                t('settings.integrationsTab.litellmInstalled'),
                t('settings.integrationsTab.litellmInstallFailed')
              )
            }
          >
            {install.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-4 w-4" />
            )}
            {install.isPending
              ? t('settings.integrationsTab.litellmInstalling')
              : t('settings.integrationsTab.litellmOneClickInstall')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onOpenManualSettings}>
            {t('settings.integrationsTab.litellmUseExisting')}
          </Button>
        </>
      );
    }

    if (status.state === 'stopped') {
      return (
        <>
          <Button
            type="button"
            size="sm"
            disabled={operationPending}
            onClick={() =>
              void runAction(
                () => start.mutateAsync(),
                t('settings.integrationsTab.litellmStarted'),
                t('settings.integrationsTab.litellmStartFailed')
              )
            }
          >
            {start.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-1.5 h-4 w-4" />
            )}
            {t('settings.integrationsTab.litellmStart')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onOpenManualSettings}>
            {t('settings.integrationsTab.litellmConnectionSettings')}
          </Button>
        </>
      );
    }

    if (status.state === 'external-running') {
      return (
        <Button type="button" size="sm" onClick={onOpenManualSettings}>
          <Settings2 className="mr-1.5 h-4 w-4" />
          {t('settings.integrationsTab.litellmConnectExisting')}
        </Button>
      );
    }

    return (
      <>
        <Button type="button" size="sm" disabled={operationPending} onClick={handleOpenAdmin}>
          {openAdmin.isPending ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <ExternalLink className="mr-1.5 h-4 w-4" />
          )}
          {status.modelCount === 0
            ? t('settings.integrationsTab.litellmAddFirstModel')
            : t('settings.integrationsTab.litellmOpenConsole')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onOpenManualSettings}>
          <Settings2 className="mr-1.5 h-4 w-4" />
          {t('settings.integrationsTab.litellmConnectionSettings')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={operationPending}
          aria-label={t('settings.integrationsTab.litellmStop')}
          onClick={() =>
            void runAction(
              () => stop.mutateAsync(),
              t('settings.integrationsTab.litellmStopped'),
              t('settings.integrationsTab.litellmStopFailed')
            )
          }
        >
          {stop.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Power className="h-4 w-4" />
          )}
        </Button>
      </>
    );
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-full items-start gap-4 rounded-lg border border-muted bg-muted/20 p-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted/50">
          <Waypoints className="h-8 w-8 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium text-foreground">LiteLLM</h3>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className={`h-1.5 w-1.5 rounded-full ${stateTone(
                  remoteConnection
                    ? 'external-running'
                    : status?.operation
                      ? 'docker-starting'
                      : status?.state
                )}`}
              />
              {statusLabel}
            </span>
          </div>
          <p className="mt-0.5 text-sm leading-5 text-muted-foreground">{description}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">{renderActions()}</div>
        </div>
      </div>
    </div>
  );
}
