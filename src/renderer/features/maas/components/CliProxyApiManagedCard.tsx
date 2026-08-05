import {
  Copy,
  Download,
  Ellipsis,
  ExternalLink,
  Loader2,
  Network,
  Play,
  Power,
  RefreshCw,
  Settings2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  CLIPROXYAPI_MANAGED_ENDPOINT,
  type CliProxyApiManagedOperation,
} from '@shared/cliproxyapi-managed';
import type { MaasConnection } from '@shared/maas';
import { HeaderActionButton, HeaderActionToolbar } from '@renderer/lib/components/header-actions';
import { useToast } from '@renderer/lib/hooks/use-toast';
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
import {
  useCliProxyApiManagedStatus,
  useCopyCliProxyApiManagementKey,
  useInstallCliProxyApi,
  useMaasConnections,
  useOpenCliProxyApiAdmin,
  useStartCliProxyApi,
  useStopCliProxyApi,
} from '../useMaas';
import { ManagedGatewayCardShell } from './ManagedGatewayCardShell';

type CliProxyApiManagedCardProps = {
  onOpenManualSettings: () => void;
};

const operationActionKeys: Record<CliProxyApiManagedOperation, string> = {
  installing: 'maas.managedGateways.cliProxyApi.installing',
  starting: 'maas.managedGateways.cliProxyApi.starting',
  stopping: 'maas.managedGateways.cliProxyApi.stopping',
};

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '');
}

export function CliProxyApiManagedCard({ onOpenManualSettings }: CliProxyApiManagedCardProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: connections } = useMaasConnections();
  const connection = connections?.find(
    (candidate: MaasConnection) => candidate.platformId === 'cliproxyapi'
  );
  const statusQuery = useCliProxyApiManagedStatus();
  const install = useInstallCliProxyApi();
  const start = useStartCliProxyApi();
  const stop = useStopCliProxyApi();
  const copyManagementKey = useCopyCliProxyApiManagementKey();
  const openAdmin = useOpenCliProxyApiAdmin();
  const status = statusQuery.data;
  const operationPending =
    Boolean(status?.operation) ||
    install.isPending ||
    start.isPending ||
    stop.isPending ||
    copyManagementKey.isPending ||
    openAdmin.isPending;
  const remoteConnection =
    connection?.connected &&
    normalizeEndpoint(connection.endpoint) !== normalizeEndpoint(CLIPROXYAPI_MANAGED_ENDPOINT);

  const description = (() => {
    if (remoteConnection) {
      return t('maas.managedGateways.cliProxyApi.remoteConnectedDescription', {
        endpoint: connection.endpoint,
      });
    }
    if (statusQuery.isLoading) return t('maas.managedGateways.cliProxyApi.detecting');
    if (statusQuery.isError || !status) {
      return t('maas.managedGateways.cliProxyApi.detectionFailed');
    }
    if (status.operation) {
      return t(`maas.managedGateways.cliProxyApi.${status.operation}Description`);
    }

    switch (status.state) {
      case 'unsupported':
        return t('maas.managedGateways.cliProxyApi.unsupportedDescription');
      case 'not-installed':
        return t('maas.managedGateways.cliProxyApi.managedDescription');
      case 'stopped':
        return t('maas.managedGateways.cliProxyApi.stoppedDescription');
      case 'external-running':
        return t('maas.managedGateways.cliProxyApi.externalDescription');
      case 'running':
        return status.modelCount === 0
          ? t('maas.managedGateways.cliProxyApi.needsAccountDescription')
          : status.modelCount === null
            ? t('maas.managedGateways.cliProxyApi.runningDescription')
            : t('maas.managedGateways.cliProxyApi.readyDescription', {
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
        title: t('maas.managedGateways.cliProxyApi.adminOpened'),
        description: t('maas.managedGateways.cliProxyApi.adminOpenedHint'),
      });
    } catch (error) {
      toast({
        title: t('maas.managedGateways.cliProxyApi.openAdminFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const handleCopyManagementKey = async () => {
    try {
      await copyManagementKey.mutateAsync();
      toast({ title: t('maas.managedGateways.cliProxyApi.managementKeyCopied') });
    } catch (error) {
      toast({
        title: t('maas.managedGateways.cliProxyApi.copyManagementKeyFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const renderPrimaryAction = () => {
    if (remoteConnection) {
      return (
        <HeaderActionButton
          label={t('maas.managedGateways.manageConnection')}
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
              ? 'maas.managedGateways.cliProxyApi.detecting'
              : 'maas.managedGateways.recheck'
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

    if (status.state === 'unsupported') {
      return (
        <HeaderActionButton
          label={t('maas.managedGateways.connectExisting')}
          variant="outline"
          onClick={onOpenManualSettings}
        >
          <Settings2 className="size-4" />
        </HeaderActionButton>
      );
    }

    if (status.state === 'not-installed') {
      return (
        <HeaderActionButton
          label={t('maas.managedGateways.oneClickInstall')}
          variant="outline"
          disabled={operationPending}
          onClick={() =>
            void runAction(
              () => install.mutateAsync(),
              t('maas.managedGateways.cliProxyApi.installed'),
              t('maas.managedGateways.cliProxyApi.installFailed')
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
          label={t('maas.managedGateways.start')}
          variant="outline"
          disabled={operationPending}
          onClick={() =>
            void runAction(
              () => start.mutateAsync(),
              t('maas.managedGateways.cliProxyApi.started'),
              t('maas.managedGateways.cliProxyApi.startFailed')
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
          label={t('maas.managedGateways.connectExisting')}
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
            ? 'maas.managedGateways.cliProxyApi.addFirstAccount'
            : 'maas.managedGateways.openConsole'
        )}
        variant="outline"
        disabled={operationPending}
        onClick={() => void handleOpenAdmin()}
      >
        {openAdmin.isPending ? (
          <Loader2 className="size-4 animate-spin" />
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
    const menuLabel = t('maas.managedGateways.cliProxyApi.manageActions');

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
              {t('maas.managedGateways.cliProxyApi.management')}
              {status.installedVersion && (
                <span className="mt-1 block font-normal text-muted-foreground">
                  v{status.installedVersion}
                </span>
              )}
            </DropdownMenuLabel>
            {running && (
              <DropdownMenuItem onClick={() => void handleCopyManagementKey()}>
                <Copy className="size-4" />
                {t('maas.managedGateways.cliProxyApi.copyManagementKey')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onOpenManualSettings}>
              <Settings2 className="size-4" />
              {t('maas.managedGateways.connectionSettings')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void statusQuery.refetch()}>
              <RefreshCw className="size-4" />
              {t('maas.managedGateways.recheck')}
            </DropdownMenuItem>
            {running && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() =>
                    void runAction(
                      () => stop.mutateAsync(),
                      t('maas.managedGateways.cliProxyApi.stopped'),
                      t('maas.managedGateways.cliProxyApi.stopFailed')
                    )
                  }
                >
                  <Power className="size-4" />
                  {t('maas.managedGateways.stopService')}
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
      testId="cliproxyapi-managed-card"
      icon={<Network className="h-8 w-8 text-primary" />}
      name="CLIProxyAPI"
      description={description}
      actions={
        <HeaderActionToolbar label={t('maas.managedGateways.cliProxyApi.actions')}>
          {renderPrimaryAction()}
          {renderManagementMenu()}
        </HeaderActionToolbar>
      }
    />
  );
}
