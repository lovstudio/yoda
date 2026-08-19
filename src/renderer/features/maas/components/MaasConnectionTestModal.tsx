import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  RotateCw,
  Settings2,
  XCircle,
} from 'lucide-react';
import type React from 'react';
import { useTranslation } from 'react-i18next';
import type { MaasPlatformId } from '@shared/maas';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogContentArea,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { cn } from '@renderer/utils/utils';
import { useCheckMaasConnection, useMaasConnections } from '../useMaas';

type Props = BaseModalProps<void> & {
  platformId: MaasPlatformId;
  onConfigure?: () => void;
};

function formatDateTime(value: string | null): string {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function MaasConnectionTestModal({ platformId, onConfigure, onClose }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: connections } = useMaasConnections();
  const checkMutation = useCheckMaasConnection();
  const connection = connections?.find((item) => item.platformId === platformId);

  const retry = () => {
    checkMutation.mutate(platformId, {
      onError: (error) =>
        toast({
          title: t('maas.connection.testFailed'),
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        }),
    });
  };

  const copyError = () => {
    const message = connection?.lastTest?.error;
    if (!message) return;
    void rpc.app.clipboardWriteText(message).then(() => {
      toast({ title: t('maas.connection.testErrorCopied') });
    });
  };

  if (!connection) {
    return (
      <>
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold tracking-normal text-foreground normal-case">
            {t('maas.connection.testDialogTitle')}
          </DialogTitle>
        </DialogHeader>
        <DialogContentArea className="px-6 pb-6">
          <p className="text-sm text-muted-foreground">{t('maas.connection.testDialogSubtitle')}</p>
        </DialogContentArea>
      </>
    );
  }

  const lastTest = connection.lastTest;
  const status: 'ok' | 'failed' | 'none' = !lastTest ? 'none' : lastTest.ok ? 'ok' : 'failed';

  return (
    <>
      <DialogHeader>
        <div className="min-w-0 flex-1">
          <DialogTitle className="text-lg font-semibold tracking-normal text-foreground normal-case">
            {t('maas.connection.testDialogTitle')}
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm leading-relaxed">
            {t('maas.connection.testDialogSubtitle')}
          </DialogDescription>
        </div>
      </DialogHeader>
      <DialogContentArea className="gap-4 px-6 pb-6 pt-0">
        <section className="rounded-lg border border-border bg-background p-4">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-md',
                status === 'ok'
                  ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400'
                  : status === 'failed'
                    ? 'bg-amber-500/12 text-amber-600 dark:text-amber-400'
                    : 'bg-foreground/5 text-foreground-muted'
              )}
            >
              {status === 'ok' ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : status === 'failed' ? (
                <AlertTriangle className="h-4 w-4" />
              ) : (
                <Activity className="h-4 w-4" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">
                  {connection.displayName}
                </span>
                <Badge
                  variant="outline"
                  className={cn(
                    'border-border/70',
                    status === 'ok' &&
                      'border-emerald-500/30 text-emerald-700 dark:text-emerald-300',
                    status === 'failed' && 'border-amber-500/30 text-amber-700 dark:text-amber-300'
                  )}
                >
                  {status === 'ok'
                    ? t('maas.connection.testPassed')
                    : status === 'failed'
                      ? t('maas.connection.lastCheckFailed')
                      : t('maas.connection.neverChecked')}
                </Badge>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {lastTest
                  ? t('maas.connection.lastChecked', { time: formatDateTime(lastTest.checkedAt) })
                  : t('maas.connection.neverChecked')}
              </p>
              {lastTest?.averageLatencyMs != null ? (
                <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                  {t('maas.connection.averageLatency', { latency: lastTest.averageLatencyMs })}
                </p>
              ) : null}
            </div>
          </div>
        </section>

        {lastTest?.error ? (
          <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3.5 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                {t('maas.connection.testErrorLabel')}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 gap-1.5 px-2"
                onClick={copyError}
              >
                <Copy className="h-3 w-3" />
                {t('maas.connection.copyError')}
              </Button>
            </div>
            <p className="mt-1.5 font-mono text-xs leading-relaxed [overflow-wrap:anywhere] text-foreground">
              {lastTest.error}
            </p>
          </section>
        ) : null}

        {lastTest && lastTest.samples.length > 0 ? (
          <section className="rounded-lg border border-border/70 bg-background-1 px-3.5 py-3">
            <div className="text-xs font-medium text-muted-foreground">
              {t('maas.connection.testSamplesTitle')}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {lastTest.samples.map((sample, index) => (
                <div
                  key={index}
                  className="flex items-center justify-center gap-1.5 rounded-md border border-border/70 bg-background px-2 py-1.5 text-xs text-foreground"
                >
                  {sample.ok ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                  )}
                  <span className="tabular-nums">{sample.durationMs} ms</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="rounded-lg border border-border/70 bg-background-1 px-3.5 py-3">
          <div className="text-xs font-medium text-muted-foreground">
            {t('maas.connection.siteConfigTitle')}
          </div>
          <div className="mt-2 grid gap-1.5 text-xs">
            <div className="min-w-0 rounded-md border border-border/70 bg-background px-3 py-2">
              <div className="text-[11px] text-muted-foreground">
                {t('maas.connection.endpoint')}
              </div>
              <div className="mt-0.5 truncate font-mono text-foreground">{connection.endpoint}</div>
            </div>
            {connection.websiteUrl ? (
              <button
                type="button"
                className="group flex min-w-0 items-center justify-between gap-2 rounded-md border border-border/70 bg-background px-3 py-2 text-left transition-colors hover:border-primary/40"
                onClick={() => void rpc.app.openExternal(connection.websiteUrl!)}
              >
                <span className="min-w-0">
                  <span className="block text-[11px] text-muted-foreground">
                    {t('maas.connection.websiteLabel')}
                  </span>
                  <span className="mt-0.5 block truncate text-foreground">
                    {connection.websiteUrl}
                  </span>
                </span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
              </button>
            ) : null}
          </div>
        </section>
      </DialogContentArea>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            onConfigure?.();
            onClose();
          }}
        >
          <Settings2 className="h-3.5 w-3.5" />
          {t('maas.connection.configureSite')}
        </Button>
        <Button type="button" onClick={retry} disabled={checkMutation.isPending}>
          {checkMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RotateCw className="h-3.5 w-3.5" />
          )}
          {checkMutation.isPending ? t('maas.connection.testing') : t('maas.connection.retryTest')}
        </Button>
      </DialogFooter>
    </>
  );
}
