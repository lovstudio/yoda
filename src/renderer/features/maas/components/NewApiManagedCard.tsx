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
  Route,
  Settings2,
  WandSparkles,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MaasConnection } from '@shared/maas';
import {
  NEW_API_DOCKER_DESKTOP_URL,
  NEW_API_MANAGED_ADMIN_USERNAME,
  NEW_API_MANAGED_ENDPOINT,
  type NewApiManagedOperation,
} from '@shared/new-api-managed';
import { YODA_MAAS_DOCS_URL } from '@shared/urls';
import {
  useCopyNewApiAdminPassword,
  useInitializeNewApi,
  useInstallNewApi,
  useMaasConnections,
  useNewApiManagedStatus,
  useOpenNewApiAdmin,
  useStartDockerForNewApi,
  useStartNewApi,
  useStopNewApi,
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

type NewApiManagedCardProps = {
  onOpenManualSettings: () => void;
  starCount?: number | null;
};

const operationActionKeys: Record<NewApiManagedOperation, string> = {
  installing: 'settings.integrationsTab.newApiInstalling',
  initializing: 'settings.integrationsTab.newApiInitializing',
  starting: 'settings.integrationsTab.newApiStarting',
  stopping: 'settings.integrationsTab.newApiStopping',
  'starting-docker': 'settings.integrationsTab.newApiStartingDocker',
};

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '');
}

export function NewApiManagedCard({ onOpenManualSettings, starCount }: NewApiManagedCardProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: connections } = useMaasConnections();
  const connection = connections?.find(
    (candidate: MaasConnection) => candidate.platformId === 'newapi'
  );
  const statusQuery = useNewApiManagedStatus();
  const install = useInstallNewApi();
  const initialize = useInitializeNewApi();
  const start = useStartNewApi();
  const stop = useStopNewApi();
  const startDocker = useStartDockerForNewApi();
  const copyAdminPassword = useCopyNewApiAdminPassword();
  const openAdmin = useOpenNewApiAdmin();

  const status = statusQuery.data;
  const operationPending =
    Boolean(status?.operation) ||
    install.isPending ||
    initialize.isPending ||
    start.isPending ||
    stop.isPending ||
    startDocker.isPending ||
    copyAdminPassword.isPending ||
    openAdmin.isPending;
  const remoteConnection =
    connection?.connected &&
    normalizeEndpoint(connection.endpoint) !== normalizeEndpoint(NEW_API_MANAGED_ENDPOINT);

  const description = (() => {
    if (remoteConnection) {
      return t('settings.integrationsTab.newApiRemoteConnectedDescription', {
        endpoint: connection.endpoint,
      });
    }
    if (statusQuery.isLoading) return t('settings.integrationsTab.newApiDetecting');
    if (statusQuery.isError || !status) {
      return t('settings.integrationsTab.newApiDetectionFailed');
    }
    if (status.operation === 'installing') {
      return t('settings.integrationsTab.newApiInstallingDescription');
    }
    if (status.operation === 'initializing') {
      return t('settings.integrationsTab.newApiInitializingDescription');
    }
    if (status.operation === 'starting') {
      return t('settings.integrationsTab.newApiStartingDescription');
    }
    if (status.operation === 'stopping') {
      return t('settings.integrationsTab.newApiStoppingDescription');
    }
    if (status.operation === 'starting-docker') {
      return t('settings.integrationsTab.newApiDockerStartingDescription');
    }

    switch (status.state) {
      case 'docker-missing':
        return t('settings.integrationsTab.newApiDockerMissingDescription');
      case 'docker-starting':
        return t('settings.integrationsTab.newApiDockerStartingDescription');
      case 'docker-stopped':
        return t('settings.integrationsTab.newApiDockerStoppedDescription');
      case 'not-installed':
        return t('settings.integrationsTab.newApiManagedDescription');
      case 'stopped':
        return t('settings.integrationsTab.newApiStoppedDescription');
      case 'needs-setup':
        return t('settings.integrationsTab.newApiNeedsSetupDescription');
      case 'external-running':
        return t('settings.integrationsTab.newApiExternalDescription');
      case 'running':
        return status.modelCount === 0
          ? t('settings.integrationsTab.newApiNeedsChannelDescription')
          : status.modelCount === null
            ? t('settings.integrationsTab.newApiRunningDescription')
            : t('settings.integrationsTab.newApiReadyDescription', {
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
        title: t('settings.integrationsTab.newApiAdminOpened'),
        description: t('settings.integrationsTab.newApiAdminCredentialsHint'),
      });
    } catch (error) {
      toast({
        title: t('settings.integrationsTab.newApiOpenAdminFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const handleCopyAdminPassword = async () => {
    try {
      await copyAdminPassword.mutateAsync();
      toast({
        title: t('settings.integrationsTab.newApiAdminPasswordCopied'),
        description: t('settings.integrationsTab.newApiAdminPasswordCopiedHint'),
      });
    } catch (error) {
      toast({
        title: t('settings.integrationsTab.newApiCopyAdminPasswordFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const renderPrimaryAction = () => {
    if (remoteConnection) {
      return (
        <HeaderActionButton
          label={t('settings.integrationsTab.newApiManageConnection')}
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
              ? 'settings.integrationsTab.newApiDetecting'
              : 'settings.integrationsTab.newApiRecheck'
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
          label={t('settings.integrationsTab.newApiDownloadDocker')}
          variant="outline"
          onClick={() => void rpc.app.openExternal(NEW_API_DOCKER_DESKTOP_URL)}
        >
          <Download className="size-4" />
        </HeaderActionButton>
      );
    }

    if (status.state === 'docker-stopped') {
      if (!status.canStartDocker) {
        return (
          <HeaderActionButton
            label={t('settings.integrationsTab.newApiRecheck')}
            variant="outline"
            onClick={() => void statusQuery.refetch()}
          >
            <RefreshCw className="size-4" />
          </HeaderActionButton>
        );
      }
      return (
        <HeaderActionButton
          label={t('settings.integrationsTab.newApiStartDocker')}
          variant="outline"
          disabled={operationPending}
          onClick={() =>
            void runAction(
              () => startDocker.mutateAsync(),
              t('settings.integrationsTab.newApiDockerStartRequested'),
              t('settings.integrationsTab.newApiDockerStartFailed')
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
          label={t('settings.integrationsTab.newApiStartingDocker')}
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
              ? 'settings.integrationsTab.newApiInstalling'
              : 'settings.integrationsTab.newApiOneClickInstall'
          )}
          variant="outline"
          disabled={operationPending}
          onClick={() =>
            void runAction(
              () => install.mutateAsync(),
              t('settings.integrationsTab.newApiInstalled'),
              t('settings.integrationsTab.newApiInstallFailed')
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
          label={t('settings.integrationsTab.newApiStart')}
          variant="outline"
          disabled={operationPending}
          onClick={() =>
            void runAction(
              () => start.mutateAsync(),
              t('settings.integrationsTab.newApiStarted'),
              t('settings.integrationsTab.newApiStartFailed')
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

    if (status.state === 'needs-setup') {
      return (
        <HeaderActionButton
          label={t('settings.integrationsTab.newApiCompleteSetup')}
          variant="outline"
          disabled={operationPending}
          onClick={() =>
            void runAction(
              () => initialize.mutateAsync(),
              t('settings.integrationsTab.newApiInitialized'),
              t('settings.integrationsTab.newApiInitializeFailed')
            )
          }
        >
          {initialize.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <WandSparkles className="size-4" />
          )}
        </HeaderActionButton>
      );
    }

    if (status.state === 'external-running') {
      return (
        <HeaderActionButton
          label={t('settings.integrationsTab.newApiConnectExisting')}
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
            ? 'settings.integrationsTab.newApiAddFirstChannel'
            : 'settings.integrationsTab.newApiOpenConsole'
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
    const menuLabel = t('settings.integrationsTab.newApiManageActions');

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
              <span className="block">{t('settings.integrationsTab.newApiManagement')}</span>
              {running && status.credentialsAvailable && (
                <span className="mt-1 block font-normal text-muted-foreground">
                  {t('settings.integrationsTab.newApiAdminAccount')}
                  <code className="ml-1 font-mono text-foreground">
                    {NEW_API_MANAGED_ADMIN_USERNAME}
                  </code>
                </span>
              )}
            </DropdownMenuLabel>
            {running && status.credentialsAvailable && (
              <DropdownMenuItem onClick={() => void handleCopyAdminPassword()}>
                <Copy className="size-4" />
                {t('settings.integrationsTab.newApiCopyAdminPassword')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onOpenManualSettings}>
              <Settings2 className="size-4" />
              {t(
                status.state === 'not-installed'
                  ? 'settings.integrationsTab.newApiUseExisting'
                  : 'settings.integrationsTab.newApiConnectionSettings'
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => void rpc.app.openExternal(`${YODA_MAAS_DOCS_URL}#new-api`)}
            >
              <BookOpen className="size-4" />
              {t('maas.managedGateways.integrationDocs')}
            </DropdownMenuItem>
            {showRecheck && (
              <DropdownMenuItem onClick={() => void statusQuery.refetch()}>
                <RefreshCw className="size-4" />
                {t('settings.integrationsTab.newApiRecheck')}
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
                      t('settings.integrationsTab.newApiStopped'),
                      t('settings.integrationsTab.newApiStopFailed')
                    )
                  }
                >
                  <Power className="size-4" />
                  {t('settings.integrationsTab.newApiStopService')}
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
      testId="new-api-integration-card"
      icon={<Route className="h-8 w-8 text-primary" />}
      name="New API"
      description={description}
      starCount={starCount}
      actions={
        <HeaderActionToolbar label={t('settings.integrationsTab.newApiActions')}>
          {renderPrimaryAction()}
          {renderManagementMenu()}
        </HeaderActionToolbar>
      }
    />
  );
}
