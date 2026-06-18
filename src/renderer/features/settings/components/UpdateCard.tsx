import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { PRODUCT_NAME } from '@shared/app-identity';
import { appState } from '@renderer/lib/stores/app-state';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { formatBytes } from '@renderer/utils/formatBytes';
import { SettingRow } from './SettingRow';
import { UpdateProxyRow } from './UpdateProxyRow';

export const UpdateCard = observer(function UpdateCard(): React.JSX.Element {
  const { t } = useTranslation();
  const update = appState.update;
  const downloadProgress =
    update.state.status === 'downloading' ? update.state.progress : undefined;
  const hasByteProgress =
    downloadProgress !== undefined &&
    ((downloadProgress.total ?? 0) > 0 || (downloadProgress.transferred ?? 0) > 0);

  const versionTitle = (
    <div className="flex items-center gap-2">
      {t('settings.update.version')}
      {update.currentVersion && (
        <Badge variant="outline" className="h-5 px-2 font-mono text-xs">
          v{update.currentVersion}
        </Badge>
      )}
    </div>
  );

  return (
    <div className="grid gap-3">
      <SettingRow
        title={versionTitle}
        description={renderStatusMessage()}
        control={
          <div className="flex items-center gap-2">
            {update.state.status !== 'downloaded' && update.state.status !== 'installing' && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => update.check()}
                disabled={update.state.status === 'checking'}
                aria-label={t('settings.update.checkForUpdates')}
              >
                <RefreshCw
                  className={`h-3 w-3 ${update.state.status === 'checking' ? 'animate-spin' : ''}`}
                />
              </Button>
            )}
            {renderAction()}
          </div>
        }
      />

      {update.state.status === 'downloading' && downloadProgress && (
        <div className="space-y-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${downloadProgress.percent || 0}%` }}
            />
          </div>
          {hasByteProgress && (
            <p className="text-xs text-muted-foreground">
              {formatBytes(downloadProgress.transferred || 0)} /{' '}
              {formatBytes(downloadProgress.total || 0)}
            </p>
          )}
        </div>
      )}

      <UpdateProxyRow />
    </div>
  );

  function renderStatusMessage() {
    switch (update.state.status) {
      case 'checking':
        return (
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t('settings.update.checking')}
          </p>
        );

      case 'available':
        if (update.state.info?.version) {
          return (
            <p className="text-sm text-muted-foreground">
              {t('settings.update.available', { version: update.state.info.version })}
            </p>
          );
        }
        return (
          <p className="text-sm text-muted-foreground">{t('settings.update.availableGeneric')}</p>
        );

      case 'downloading':
        return (
          <p className="text-sm text-muted-foreground">
            {update.progressLabel
              ? t('settings.update.downloadingWith', { progress: update.progressLabel })
              : t('settings.update.downloading')}
          </p>
        );

      case 'downloaded':
        return (
          <p className="flex items-center gap-1 text-sm text-green-600 dark:text-green-500">
            <CheckCircle2 className="h-3 w-3" />
            {t('settings.update.ready', { product: PRODUCT_NAME })}
          </p>
        );

      case 'installing':
        return (
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t('settings.update.installing', { product: PRODUCT_NAME })}
          </p>
        );

      case 'error':
        return (
          <div className="grid gap-2">
            <Badge
              variant="outline"
              className="w-fit border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400"
            >
              <AlertCircle className="h-3 w-3" />
              {t('settings.update.errorBadge')}
            </Badge>
            <p className="text-xs text-muted-foreground">{update.state.message}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => (update.availableVersion ? update.download() : update.check())}
                className="h-7 text-xs"
              >
                <RefreshCw className="mr-1.5 h-3 w-3" />
                {t('settings.update.retry')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => update.openReleasePage()}
                className="h-7 text-xs"
              >
                <ExternalLink className="mr-1.5 h-3 w-3" />
                {t('settings.update.manualDownload')}
              </Button>
            </div>
          </div>
        );

      default:
        return (
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-500" />
            {t('settings.update.upToDate')}{' '}
          </p>
        );
    }
  }

  function renderAction() {
    switch (update.state.status) {
      case 'available':
        return (
          <Button
            size="sm"
            variant="default"
            onClick={() => update.download()}
            className="h-7 text-xs"
          >
            <Download className="mr-1.5 h-3 w-3" />
            {t('settings.update.download')}
          </Button>
        );

      case 'downloading':
        return (
          <Button size="sm" variant="outline" disabled className="h-7 text-xs">
            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
            {t('settings.update.downloadingShort')}
          </Button>
        );

      case 'downloaded':
        return (
          <Button
            size="sm"
            variant="default"
            onClick={() => update.install()}
            className="h-7 text-xs"
          >
            <RefreshCw className="mr-1.5 h-3 w-3" />
            {t('settings.update.restart')}
          </Button>
        );

      case 'installing':
        return (
          <Button size="sm" variant="outline" disabled className="h-7 text-xs">
            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
            {t('settings.update.installingShort')}
          </Button>
        );

      default:
        return null;
    }
  }
});
