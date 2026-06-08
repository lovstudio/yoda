import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  Copy,
  Download,
  QrCode,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Smartphone,
  WifiOff,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { cn } from '@renderer/utils/utils';

type Props = BaseModalProps<void>;

async function copyToClipboard(value: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error('Clipboard is not available');
  await navigator.clipboard.writeText(value);
}

function copy(value: string, successMessage: string, failureMessage: string): void {
  void copyToClipboard(value)
    .then(() => toast.success(successMessage))
    .catch(() => toast.error(failureMessage));
}

function QRPanel({
  title,
  description,
  value,
  icon,
  disabledLabel,
}: {
  title: string;
  description: string;
  value: string | null;
  icon: ReactNode;
  disabledLabel: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-background p-3">
      <div className="flex items-start gap-2">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background-quaternary-1 text-foreground">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">{title}</div>
          <p className="mt-1 text-xs leading-5 text-foreground-muted">{description}</p>
        </div>
      </div>

      <div className="flex aspect-square min-h-[168px] items-center justify-center rounded-lg border border-border bg-white p-3">
        {value ? (
          <QRCodeSVG value={value} size={156} marginSize={2} bgColor="#ffffff" fgColor="#171717" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-center text-xs text-foreground-muted">
            <WifiOff className="size-5" />
            <span>{disabledLabel}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  copyLabel,
  disabled,
}: {
  label: string;
  value: string;
  copyLabel: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-mono uppercase tracking-wide text-foreground-tertiary-passive">
          {label}
        </div>
        <div className="mt-0.5 truncate font-mono text-xs text-foreground">{value}</div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon-xs"
        aria-label={copyLabel}
        disabled={disabled}
        onClick={() => copy(value, t('common.copied'), t('common.copyFailed'))}
      >
        <Copy className="size-3" />
      </Button>
    </div>
  );
}

export function MobileConnectionModal({ onClose }: Props) {
  const { t } = useTranslation();
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['mobileGateway', 'connectionInfo'],
    queryFn: () => rpc.mobileGateway.getConnectionInfo(),
  });

  const primaryUrl = data?.urls[0] ?? (data ? `http://localhost:${data.port}` : '');
  const localExpoUrl = data?.localExpoUrl ?? null;
  const installUrl = data?.installUrl ?? '';
  const pairingUrl = data?.pairingUrl ?? null;
  const isReady = Boolean(data?.running && data.token && primaryUrl && pairingUrl);
  const details = useMemo(() => {
    if (!data) return '';
    return [
      `${t('sidebar.mobileConnection.installUrl')}: ${installUrl}`,
      `${t('sidebar.mobileConnection.localExpoUrl')}: ${localExpoUrl ?? ''}`,
      `${t('sidebar.mobileConnection.gatewayUrl')}: ${primaryUrl}`,
      `${t('sidebar.mobileConnection.token')}: ${data.token ?? ''}`,
      `${t('sidebar.mobileConnection.pairingUrl')}: ${pairingUrl ?? ''}`,
    ].join('\n');
  }, [data, installUrl, localExpoUrl, pairingUrl, primaryUrl, t]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('sidebar.mobileConnection.title')}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="gap-4">
        <div className="flex items-start gap-3 rounded-lg border border-border bg-background-quaternary-1 p-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
            <Smartphone className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground">
              {t('sidebar.mobileConnection.heading')}
            </div>
            <p className="mt-1 text-xs leading-5 text-foreground-muted">
              {t('sidebar.mobileConnection.description')}
            </p>
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-border-destructive bg-background-destructive px-3 py-2 text-xs text-foreground-destructive">
            {t('sidebar.mobileConnection.loadFailed')}
          </div>
        ) : null}

        <div
          className={cn(
            'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs',
            isReady
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
          )}
        >
          {isReady ? <CheckCircle2 className="size-4" /> : <WifiOff className="size-4" />}
          <span className="font-medium">
            {isLoading
              ? t('common.loading')
              : isReady
                ? t('sidebar.mobileConnection.running')
                : data?.enabled
                  ? t('sidebar.mobileConnection.notReady')
                  : t('sidebar.mobileConnection.disabled')}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <QRPanel
            title={t('sidebar.mobileConnection.localExpoTitle')}
            description={t('sidebar.mobileConnection.localExpoDescription')}
            value={localExpoUrl}
            icon={<ScanLine className="size-4" />}
            disabledLabel={t('sidebar.mobileConnection.localExpoUnavailable')}
          />
          <QRPanel
            title={t('sidebar.mobileConnection.installTitle')}
            description={t('sidebar.mobileConnection.installDescription')}
            value={installUrl || null}
            icon={<Download className="size-4" />}
            disabledLabel={t('sidebar.mobileConnection.installUnavailable')}
          />
          <QRPanel
            title={t('sidebar.mobileConnection.connectTitle')}
            description={t('sidebar.mobileConnection.connectDescription')}
            value={isReady ? pairingUrl : null}
            icon={<QrCode className="size-4" />}
            disabledLabel={t('sidebar.mobileConnection.connectUnavailable')}
          />
        </div>

        <div className="grid gap-2">
          {localExpoUrl ? (
            <InfoRow
              label={t('sidebar.mobileConnection.localExpoUrl')}
              value={localExpoUrl}
              copyLabel={t('sidebar.mobileConnection.copyLocalExpoUrl')}
            />
          ) : null}
          <InfoRow
            label={t('sidebar.mobileConnection.gatewayUrl')}
            value={primaryUrl || t('common.loading')}
            copyLabel={t('sidebar.mobileConnection.copyGatewayUrl')}
            disabled={!primaryUrl}
          />
          <InfoRow
            label={t('sidebar.mobileConnection.token')}
            value={data?.token ?? t('common.loading')}
            copyLabel={t('sidebar.mobileConnection.copyToken')}
            disabled={!data?.token}
          />
        </div>

        {data && data.urls.length > 1 ? (
          <div className="grid gap-1">
            <div className="text-[10px] font-mono uppercase tracking-wide text-foreground-tertiary-passive">
              {t('sidebar.mobileConnection.otherAddresses')}
            </div>
            {data.urls.slice(1).map((url) => (
              <button
                key={url}
                type="button"
                className="truncate rounded-md px-2 py-1 text-left font-mono text-xs text-foreground-muted hover:bg-background-1 hover:text-foreground"
                onClick={() => copy(url, t('common.copied'), t('common.copyFailed'))}
              >
                {url}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex items-start gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs leading-5 text-foreground-muted">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-foreground-muted" />
          <span>{t('sidebar.mobileConnection.securityNote')}</span>
        </div>
      </DialogContentArea>
      <DialogFooter className="sm:justify-between">
        <Button variant="outline" onClick={onClose}>
          {t('common.close')}
        </Button>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn('size-4', isFetching && 'animate-spin')} />
            {t('common.refresh')}
          </Button>
          <Button
            type="button"
            disabled={!isReady}
            onClick={() => copy(details, t('common.copied'), t('common.copyFailed'))}
          >
            <Copy className="size-4" />
            {t('sidebar.mobileConnection.copyAll')}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
