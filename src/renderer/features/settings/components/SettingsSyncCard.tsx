import { useQuery } from '@tanstack/react-query';
import { Cloud, Download, FileDown, FileUp, RefreshCw, Upload } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SettingsSyncMode, SettingsSyncResult } from '@shared/settings-sync';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import {
  exportSettingsFile,
  importSettingsFile,
  restartAfterSettingsRestore,
  syncSettings,
} from '@renderer/lib/settings-sync';
import { Button } from '@renderer/lib/ui/button';
import { Switch } from '@renderer/lib/ui/switch';

const SETTINGS_SYNC_STATUS_KEY = ['settings-sync', 'status'] as const;

export function SettingsSyncCard() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const status = useQuery({
    queryKey: SETTINGS_SYNC_STATUS_KEY,
    queryFn: () => rpc.settingsSync.getStatus(),
  });
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SettingsSyncResult | null>(null);

  const reportError = (error: unknown) => {
    toast({
      title: t('settings.account.settingsSync.failed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive',
    });
  };

  const runSync = async (mode: SettingsSyncMode) => {
    setBusyAction(mode);
    try {
      const result = await syncSettings(mode);
      setLastResult(result);
      await status.refetch();
      if (result.status === 'downloaded') {
        toast({ title: t('settings.account.settingsSync.restored') });
        await restartAfterSettingsRestore();
        return;
      }
      if (result.status === 'conflict') return;
      toast({
        title: t(
          result.status === 'uploaded'
            ? 'settings.account.settingsSync.uploaded'
            : 'settings.account.settingsSync.synced'
        ),
      });
    } catch (error) {
      reportError(error);
    } finally {
      setBusyAction(null);
    }
  };

  const exportFile = async () => {
    setBusyAction('export');
    try {
      const result = await exportSettingsFile();
      if (result.status === 'exported') {
        toast({
          title: t('settings.account.settingsSync.exported'),
          description: result.filePath,
        });
      }
    } catch (error) {
      reportError(error);
    } finally {
      setBusyAction(null);
    }
  };

  const importFile = async () => {
    setBusyAction('import');
    try {
      const result = await importSettingsFile();
      if (result.status === 'imported') await restartAfterSettingsRestore();
    } catch (error) {
      reportError(error);
    } finally {
      setBusyAction(null);
    }
  };

  const setAutoSync = async (enabled: boolean) => {
    setBusyAction('toggle');
    try {
      await rpc.settingsSync.setAutoSyncEnabled(enabled);
      await status.refetch();
      if (enabled) void runSync('auto');
    } catch (error) {
      reportError(error);
    } finally {
      setBusyAction(null);
    }
  };

  const lastSyncedAt = status.data?.lastSyncedAt;
  const busy = busyAction !== null;

  return (
    <section className="grid gap-4 py-4 @2xl:grid-cols-[10rem_minmax(0,1fr)]">
      <div>
        <div className="flex items-center gap-2">
          <Cloud className="size-4 text-foreground-muted" />
          <p className="text-sm font-medium text-foreground">
            {t('settings.account.settingsSync.title')}
          </p>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-foreground-passive">
          {t('settings.account.settingsSync.description')}
        </p>
      </div>
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background-quaternary-1 p-3">
          <div className="min-w-0">
            <p className="text-sm text-foreground">{t('settings.account.settingsSync.autoSync')}</p>
            <p className="mt-0.5 text-xs text-foreground-passive">
              {lastSyncedAt
                ? t('settings.account.settingsSync.lastSynced', {
                    date: new Date(lastSyncedAt).toLocaleString(),
                  })
                : t('settings.account.settingsSync.notSynced')}
            </p>
          </div>
          <Switch
            checked={status.data?.autoSyncEnabled ?? true}
            disabled={status.isLoading || busyAction === 'toggle'}
            onCheckedChange={(checked) => void setAutoSync(checked)}
            aria-label={t('settings.account.settingsSync.autoSync')}
          />
        </div>

        {lastResult?.status === 'conflict' && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
            <p className="text-sm font-medium text-foreground">
              {t('settings.account.settingsSync.conflictTitle')}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-foreground-muted">
              {t('settings.account.settingsSync.conflictDescription')}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={busy} onClick={() => void runSync('auto')}>
            <RefreshCw className={busyAction === 'auto' ? 'size-3.5 animate-spin' : 'size-3.5'} />
            {t('settings.account.settingsSync.syncNow')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void runSync('upload')}
          >
            <Upload className="size-3.5" />
            {t('settings.account.settingsSync.useLocal')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void runSync('download')}
          >
            <Download className="size-3.5" />
            {t('settings.account.settingsSync.useCloud')}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void exportFile()}
          >
            <FileDown className="size-3.5" />
            {t('settings.account.settingsSync.export')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void importFile()}
          >
            <FileUp className="size-3.5" />
            {t('settings.account.settingsSync.import')}
          </Button>
        </div>
        <p className="text-xs leading-relaxed text-foreground-passive">
          {t('settings.account.settingsSync.securityNote')}
        </p>
      </div>
    </section>
  );
}
