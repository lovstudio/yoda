import {
  ArrowLeftRight,
  BookOpen,
  Download,
  Ellipsis,
  ExternalLink,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  CC_SWITCH_APP_NAME,
  CC_SWITCH_RELEASES_URL,
  CC_SWITCH_REPOSITORY_URL,
  CC_SWITCH_WEBSITE_URL,
} from '@shared/cc-switch-integration';
import {
  useCcSwitchIntegrationStatus,
  useInstallCcSwitch,
  useOpenCcSwitch,
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
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { ManagedGatewayCardShell } from './ManagedGatewayCardShell';

type CcSwitchIntegrationCardProps = {
  starCount?: number | null;
};

export function CcSwitchIntegrationCard({ starCount }: CcSwitchIntegrationCardProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const statusQuery = useCcSwitchIntegrationStatus();
  const install = useInstallCcSwitch();
  const open = useOpenCcSwitch();

  const status = statusQuery.data;
  const operationPending = Boolean(status?.operation) || install.isPending || open.isPending;

  const description = (() => {
    if (statusQuery.isLoading) return t('maas.managedGateways.ccSwitch.detecting');
    if (statusQuery.isError || !status) return t('maas.managedGateways.ccSwitch.detectionFailed');
    if (status.operation === 'installing') {
      return t('maas.managedGateways.ccSwitch.installingDescription');
    }
    if (status.state === 'not-installed') {
      return t('maas.managedGateways.ccSwitch.managedDescription');
    }
    return t(
      status.localProxyEnabled
        ? 'maas.managedGateways.ccSwitch.proxyEnabledDescription'
        : 'maas.managedGateways.ccSwitch.installedDescription',
      { version: status.installedVersion ?? '' }
    );
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

  const renderPrimaryAction = () => {
    if (statusQuery.isLoading || !status) {
      return (
        <HeaderActionButton
          label={t(
            statusQuery.isLoading
              ? 'maas.managedGateways.ccSwitch.detecting'
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

    if (status.operation === 'installing') {
      return (
        <HeaderActionButton
          label={t('maas.managedGateways.ccSwitch.installing')}
          variant="outline"
          disabled
        >
          <Loader2 className="size-4 animate-spin" />
        </HeaderActionButton>
      );
    }

    if (status.state === 'not-installed') {
      const downloadOnly = status.installMethod === 'download';
      return (
        <HeaderActionButton
          label={t(
            downloadOnly
              ? 'maas.managedGateways.ccSwitch.download'
              : 'maas.managedGateways.oneClickInstall'
          )}
          variant="outline"
          disabled={operationPending}
          onClick={() =>
            void runAction(
              () => install.mutateAsync(),
              t(
                downloadOnly
                  ? 'maas.managedGateways.ccSwitch.downloadOpened'
                  : 'maas.managedGateways.ccSwitch.installed'
              ),
              t('maas.managedGateways.ccSwitch.installFailed')
            )
          }
        >
          {install.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : downloadOnly ? (
            <ExternalLink className="size-4" />
          ) : (
            <Download className="size-4" />
          )}
        </HeaderActionButton>
      );
    }

    return (
      <HeaderActionButton
        label={t('maas.managedGateways.ccSwitch.open')}
        variant="outline"
        disabled={operationPending}
        onClick={() =>
          void runAction(
            () => open.mutateAsync(),
            t('maas.managedGateways.ccSwitch.opened'),
            t('maas.managedGateways.ccSwitch.openFailed')
          )
        }
      >
        {open.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <ExternalLink className="size-4" />
        )}
      </HeaderActionButton>
    );
  };

  const renderManagementMenu = () => {
    if (!status || status.operation) return null;
    const menuLabel = t('maas.managedGateways.ccSwitch.manageActions');

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
              {t('maas.managedGateways.ccSwitch.management')}
              {status.installedVersion && (
                <span className="mt-1 block font-normal text-muted-foreground">
                  v{status.installedVersion}
                </span>
              )}
            </DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => void rpc.app.openExternal(CC_SWITCH_WEBSITE_URL)}
              disabled={operationPending}
            >
              <BookOpen className="size-4" />
              {t('maas.managedGateways.integrationDocs')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => void rpc.app.openExternal(CC_SWITCH_RELEASES_URL)}
              disabled={operationPending}
            >
              <Download className="size-4" />
              {t('maas.managedGateways.ccSwitch.checkUpdates')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => void rpc.app.openExternal(CC_SWITCH_REPOSITORY_URL)}
              disabled={operationPending}
            >
              <ExternalLink className="size-4" />
              {t('maas.managedGateways.ccSwitch.sourceRepository')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void statusQuery.refetch()}>
              <RefreshCw className="size-4" />
              {t('maas.managedGateways.recheck')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <ManagedGatewayCardShell
      testId="cc-switch-integration-card"
      icon={<ArrowLeftRight className="h-8 w-8 text-primary" />}
      name={CC_SWITCH_APP_NAME}
      description={description}
      starCount={starCount}
      actions={
        <HeaderActionToolbar label={t('maas.managedGateways.ccSwitch.actions')}>
          {renderPrimaryAction()}
          {renderManagementMenu()}
        </HeaderActionToolbar>
      }
    />
  );
}
