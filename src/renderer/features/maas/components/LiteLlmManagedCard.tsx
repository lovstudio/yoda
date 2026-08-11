import {
  BookOpen,
  Copy,
  Download,
  Ellipsis,
  ExternalLink,
  Loader2,
  Play,
  Plus,
  Power,
  RefreshCw,
  Settings2,
  Waypoints,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  LITELLM_DOCKER_DESKTOP_URL,
  LITELLM_MANAGED_ADMIN_USERNAME,
  LITELLM_MANAGED_ENDPOINT,
  type LiteLlmManagedOperation,
} from '@shared/litellm-managed';
import type { MaasConnection } from '@shared/maas';
import { YODA_MAAS_DOCS_URL } from '@shared/urls';
import {
  useCopyLiteLlmAdminPassword,
  useInstallLiteLlm,
  useLiteLlmManagedStatus,
  useMaasConnections,
  useOpenLiteLlmAdmin,
  useStartDockerForLiteLlm,
  useStartLiteLlm,
  useStopLiteLlm,
} from '@renderer/features/maas/useMaas';
import { HeaderActionButton, HeaderActionToolbar } from '@renderer/lib/components/header-actions';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { ManagedGatewayCardShell } from './ManagedGatewayCardShell';

type LiteLlmManagedCardProps = {
  onOpenManualSettings: () => void;
  starCount?: number | null;
};

const operationActionKeys: Record<LiteLlmManagedOperation, string> = {
  installing: 'settings.integrationsTab.litellmInstalling',
  starting: 'settings.integrationsTab.litellmStarting',
  stopping: 'settings.integrationsTab.litellmStopping',
  'starting-docker': 'settings.integrationsTab.litellmStartingDocker',
};

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '');
}

export function LiteLlmManagedCard({ onOpenManualSettings, starCount }: LiteLlmManagedCardProps) {
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
  const copyAdminPassword = useCopyLiteLlmAdminPassword();
  const openAdmin = useOpenLiteLlmAdmin();

  const status = statusQuery.data;
  const operationPending =
    Boolean(status?.operation) ||
    install.isPending ||
    start.isPending ||
    stop.isPending ||
    startDocker.isPending ||
    copyAdminPassword.isPending ||
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

  const handleCopyAdminPassword = async () => {
    try {
      await copyAdminPassword.mutateAsync();
      toast({
        title: t('settings.integrationsTab.litellmAdminPasswordCopied'),
        description: t('settings.integrationsTab.litellmAdminPasswordCopiedHint'),
      });
    } catch (error) {
      toast({
        title: t('settings.integrationsTab.litellmCopyAdminPasswordFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const renderPrimaryAction = () => {
    if (remoteConnection) {
      return (
        <HeaderActionButton
          label={t('settings.integrationsTab.litellmManageConnection')}
          variant="outline"
          onClick={onOpenManualSettings}
        >
          <Settings2 className="size-4" />
        </HeaderActionButton>
      );
    }

    if (statusQuery.isLoading || !status) {
      return (
        <HeaderActionButton
          label={t(
            statusQuery.isLoading
              ? 'settings.integrationsTab.litellmDetecting'
              : 'settings.integrationsTab.litellmRecheck'
          )}
          variant="outline"
          disabled={statusQuery.isLoading}
          onClick={() => void statusQuery.refetch()}
        >
          {statusQuery.isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
        </HeaderActionButton>
      );
    }

    if (status.operation) {
      return (
        <HeaderActionButton
          label={t(operationActionKeys[status.operation])}
          variant="outline"
          disabled
        >
          <Loader2 className="size-4 animate-spin" />
        </HeaderActionButton>
      );
    }

    if (status.state === 'docker-missing') {
      return (
        <HeaderActionButton
          label={t('settings.integrationsTab.litellmDownloadDocker')}
          variant="outline"
          onClick={() => void rpc.app.openExternal(LITELLM_DOCKER_DESKTOP_URL)}
        >
          <Download className="size-4" />
        </HeaderActionButton>
      );
    }

    if (status.state === 'docker-stopped') {
      if (!status.canStartDocker) {
        return (
          <HeaderActionButton
            label={t('settings.integrationsTab.litellmRecheck')}
            variant="outline"
            onClick={() => void statusQuery.refetch()}
          >
            <RefreshCw className="size-4" />
          </HeaderActionButton>
        );
      }
      return (
        <HeaderActionButton
          label={t('settings.integrationsTab.litellmStartDocker')}
          variant="outline"
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
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Play className="size-4" />
          )}
        </HeaderActionButton>
      );
    }

    if (status.state === 'docker-starting') {
      return (
        <HeaderActionButton
          label={t('settings.integrationsTab.litellmStartingDocker')}
          variant="outline"
          disabled
        >
          <Loader2 className="size-4 animate-spin" />
        </HeaderActionButton>
      );
    }

    if (status.state === 'not-installed') {
      return (
        <HeaderActionButton
          label={t(
            install.isPending
              ? 'settings.integrationsTab.litellmInstalling'
              : 'settings.integrationsTab.litellmOneClickInstall'
          )}
          variant="outline"
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
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
        </HeaderActionButton>
      );
    }

    if (status.state === 'stopped') {
      return (
        <HeaderActionButton
          label={t('settings.integrationsTab.litellmStart')}
          variant="outline"
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
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Play className="size-4" />
          )}
        </HeaderActionButton>
      );
    }

    if (status.state === 'external-running') {
      return (
        <HeaderActionButton
          label={t('settings.integrationsTab.litellmConnectExisting')}
          variant="outline"
          onClick={onOpenManualSettings}
        >
          <Settings2 className="size-4" />
        </HeaderActionButton>
      );
    }

    return (
      <HeaderActionButton
        label={t(
          status.modelCount === 0
            ? 'settings.integrationsTab.litellmAddFirstModel'
            : 'settings.integrationsTab.litellmOpenConsole'
        )}
        variant="outline"
        disabled={operationPending}
        onClick={handleOpenAdmin}
      >
        {openAdmin.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : status.modelCount === 0 ? (
          <Plus className="size-4" />
        ) : (
          <ExternalLink className="size-4" />
        )}
      </HeaderActionButton>
    );
  };

  const renderManagementMenu = () => {
    if (remoteConnection || !status || status.operation || status.state === 'external-running') {
      return null;
    }

    const running = status.state === 'running';
    const showRecheck =
      status.state === 'docker-missing' ||
      status.state === 'docker-stopped' ||
      status.state === 'docker-starting';
    const menuLabel = t('settings.integrationsTab.litellmManageActions');

    return (
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={menuLabel}
                  disabled={operationPending}
                />
              }
            >
              <Ellipsis className="size-4" />
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>
            {menuLabel}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              <span className="block">{t('settings.integrationsTab.litellmManagement')}</span>
              {running && (
                <span className="mt-1 block font-normal text-muted-foreground">
                  {t('settings.integrationsTab.litellmAdminAccount')}
                  <code className="ml-1 font-mono text-foreground">
                    {LITELLM_MANAGED_ADMIN_USERNAME}
                  </code>
                </span>
              )}
            </DropdownMenuLabel>
            {running && (
              <DropdownMenuItem onClick={() => void handleCopyAdminPassword()}>
                <Copy className="size-4" />
                {t('settings.integrationsTab.litellmCopyAdminPassword')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onOpenManualSettings}>
              <Settings2 className="size-4" />
              {t(
                status.state === 'not-installed'
                  ? 'settings.integrationsTab.litellmUseExisting'
                  : 'settings.integrationsTab.litellmConnectionSettings'
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => void rpc.app.openExternal(`${YODA_MAAS_DOCS_URL}#litellm`)}
            >
              <BookOpen className="size-4" />
              {t('maas.managedGateways.integrationDocs')}
            </DropdownMenuItem>
            {showRecheck && (
              <DropdownMenuItem onClick={() => void statusQuery.refetch()}>
                <RefreshCw className="size-4" />
                {t('settings.integrationsTab.litellmRecheck')}
              </DropdownMenuItem>
            )}
            {running && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() =>
                    void runAction(
                      () => stop.mutateAsync(),
                      t('settings.integrationsTab.litellmStopped'),
                      t('settings.integrationsTab.litellmStopFailed')
                    )
                  }
                >
                  <Power className="size-4" />
                  {t('settings.integrationsTab.litellmStopService')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <ManagedGatewayCardShell
      testId="litellm-integration-card"
      icon={<Waypoints className="h-8 w-8 text-primary" />}
      name="LiteLLM"
      description={description}
      starCount={starCount}
      actions={
        <HeaderActionToolbar label={t('settings.integrationsTab.litellmActions')}>
          {renderPrimaryAction()}
          {renderManagementMenu()}
        </HeaderActionToolbar>
      }
    />
  );
}
