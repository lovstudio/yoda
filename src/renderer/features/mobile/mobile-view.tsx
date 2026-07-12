import { useQuery } from '@tanstack/react-query';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  FlaskConical,
  Network,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Smartphone,
  WifiOff,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MobileGatewayMode } from '@shared/mobile-api';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@renderer/lib/ui/collapsible';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { cn } from '@renderer/utils/utils';

const TAILSCALE_DOWNLOAD_URL = 'https://tailscale.com/download';
const TAILSCALE_SETUP_URL = 'https://tailscale.com/kb/1017/install';

async function copyToClipboard(value: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error('Clipboard is not available');
  await navigator.clipboard.writeText(value);
}

function copy(value: string, successMessage: string, failureMessage: string): void {
  void copyToClipboard(value)
    .then(() => toast.success(successMessage))
    .catch(() => toast.error(failureMessage));
}

function QRBox({ value, disabledLabel }: { value: string | null; disabledLabel: string }) {
  return (
    <div className="flex aspect-square w-[204px] items-center justify-center rounded-lg border border-border bg-white p-3">
      {value ? (
        <QRCodeSVG value={value} size={180} marginSize={2} bgColor="#ffffff" fgColor="#171717" />
      ) : (
        <div className="flex flex-col items-center gap-2 text-center text-xs text-foreground-muted">
          <WifiOff className="size-5" />
          <span>{disabledLabel}</span>
        </div>
      )}
    </div>
  );
}

function StepIndicator({
  steps,
  current,
  onSelect,
}: {
  steps: { title: string; label: string }[];
  current: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      {steps.map((step, index) => (
        <Fragment key={step.title}>
          {index > 0 ? <div aria-hidden className="h-px flex-1 bg-border" /> : null}
          <button
            type="button"
            aria-label={step.label}
            aria-current={index === current ? 'step' : undefined}
            onClick={() => onSelect(index)}
            className="flex items-center gap-2"
          >
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-full border font-mono text-xs',
                index === current
                  ? 'border-foreground bg-foreground text-background'
                  : index < current
                    ? 'border-border bg-background-quaternary-1 text-foreground'
                    : 'border-border text-foreground-muted'
              )}
            >
              {index < current ? <Check className="size-3.5" /> : index + 1}
            </span>
            <span
              className={cn(
                'text-sm',
                index === current ? 'font-medium text-foreground' : 'text-foreground-muted'
              )}
            >
              {step.title}
            </span>
          </button>
        </Fragment>
      ))}
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

export function MobileView({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['mobileGateway', 'connectionInfo'],
    queryFn: () => rpc.mobileGateway.getConnectionInfo(),
    // The QR encodes the current Tailscale or LAN IP; poll so a network change while the
    // panel is open refreshes it (and lets the gateway restart Metro).
    refetchInterval: 5000,
  });

  // The Dev/Prod view is a manual switch; it defaults to the host's real runtime
  // mode once the connection info loads, but the user can flip it to inspect the
  // other mode's connection methods.
  const runtimeMode = data?.mode;
  const [selectedMode, setSelectedMode] = useState<MobileGatewayMode | null>(null);
  const mode = selectedMode ?? runtimeMode ?? 'production';
  const [stepIndex, setStepIndex] = useState(0);

  const primaryUrl = data?.urls[0] ?? (data ? `http://localhost:${data.port}` : '');
  const localExpoUrl = data?.localExpoUrl ?? null;
  const installUrl = data?.installUrl ?? '';
  const pairingUrl = data?.pairingUrl ?? null;
  const isReady = Boolean(data?.running && data.token && primaryUrl && pairingUrl);
  const isDevView = mode === 'development';
  // Dev connection methods only exist in a dev build of the host app.
  const devUnavailable = Boolean(data) && runtimeMode !== 'development';

  const details = useMemo(() => {
    if (!data) return '';
    const lines = isDevView
      ? [`${t('sidebar.mobileConnection.localExpoUrl')}: ${localExpoUrl ?? ''}`]
      : [`${t('sidebar.mobileConnection.installUrl')}: ${installUrl}`];
    lines.push(
      `${t('sidebar.mobileConnection.gatewayUrl')}: ${primaryUrl}`,
      `${t('sidebar.mobileConnection.token')}: ${data.token ?? ''}`,
      `${t('sidebar.mobileConnection.pairingUrl')}: ${pairingUrl ?? ''}`
    );
    return lines.join('\n');
  }, [data, isDevView, installUrl, localExpoUrl, pairingUrl, primaryUrl, t]);

  return (
    <div
      className={cn('flex flex-col bg-background text-foreground', !embedded && 'h-full min-h-0')}
    >
      <div
        className={cn(
          'flex shrink-0 items-center gap-3 border-b border-border',
          embedded ? 'justify-end pb-3' : 'justify-between px-6 py-3'
        )}
      >
        {!embedded && (
          <div className="flex min-w-0 items-center gap-2">
            <Smartphone className="size-4 shrink-0 text-foreground-muted" />
            <h1 className="truncate text-sm font-medium">{t('sidebar.mobileConnection.title')}</h1>
          </div>
        )}
        <div className="flex shrink-0 items-center gap-2">
          <ToggleGroup
            multiple={false}
            value={[mode]}
            onValueChange={([value]) => {
              if (value) {
                setSelectedMode(value as MobileGatewayMode);
                setStepIndex(0);
              }
            }}
          >
            <ToggleGroupItem value="development" className="gap-1.5">
              <FlaskConical className="h-3.5 w-3.5" />
              <span>{t('sidebar.mobileConnection.modeDev')}</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="production" className="gap-1.5">
              <Rocket className="h-3.5 w-3.5" />
              <span>{t('sidebar.mobileConnection.modeProd')}</span>
            </ToggleGroupItem>
          </ToggleGroup>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn('size-4', isFetching && 'animate-spin')} />
            {t('common.refresh')}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!isReady || (isDevView && devUnavailable)}
            onClick={() => copy(details, t('common.copied'), t('common.copyFailed'))}
          >
            <Copy className="size-4" />
            {t('sidebar.mobileConnection.copyAll')}
          </Button>
        </div>
      </div>

      <div className={cn(!embedded && 'min-h-0 flex-1 overflow-y-auto')}>
        <div
          className={cn('flex w-full flex-col gap-4', embedded ? 'py-4' : 'mx-auto max-w-2xl p-6')}
        >
          <div className="flex items-start gap-3 rounded-lg border border-border bg-background-quaternary-1 p-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
              {isDevView ? <FlaskConical className="size-4" /> : <Rocket className="size-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground">
                {isDevView
                  ? t('sidebar.mobileConnection.devHeading')
                  : t('sidebar.mobileConnection.prodHeading')}
              </div>
              <p className="mt-1 text-xs leading-5 text-foreground-muted">
                {isDevView
                  ? t('sidebar.mobileConnection.devDescription')
                  : t('sidebar.mobileConnection.prodDescription')}
              </p>
            </div>
          </div>

          {error ? (
            <div className="rounded-lg border border-border-destructive bg-background-destructive px-3 py-2 text-xs text-foreground-destructive">
              {t('sidebar.mobileConnection.loadFailed')}
            </div>
          ) : null}

          {isDevView && devUnavailable ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
              <FlaskConical className="mt-0.5 size-4 shrink-0" />
              <span>{t('sidebar.mobileConnection.devUnavailableInProd')}</span>
            </div>
          ) : (
            <>
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
                {isReady && data?.connectionKind === 'tailscale' ? (
                  <span className="ml-auto rounded-full bg-emerald-500/15 px-2 py-0.5 font-medium">
                    {t('sidebar.mobileConnection.tailscaleReady')}
                  </span>
                ) : null}
              </div>

              <div className="rounded-lg border border-border bg-background p-4">
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      'flex size-9 shrink-0 items-center justify-center rounded-lg',
                      data?.connectionKind === 'tailscale'
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        : 'bg-background-quaternary-1 text-foreground-muted'
                    )}
                  >
                    <Network className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-medium">
                        {t('sidebar.mobileConnection.tailscaleTitle')}
                      </div>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] font-medium',
                          data?.connectionKind === 'tailscale'
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                            : 'bg-background-quaternary-1 text-foreground-muted'
                        )}
                      >
                        {data?.connectionKind === 'tailscale'
                          ? t('sidebar.mobileConnection.tailscaleDetected')
                          : t('sidebar.mobileConnection.tailscaleNotDetected')}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-foreground-muted">
                      {data?.connectionKind === 'tailscale'
                        ? t('sidebar.mobileConnection.tailscaleDetectedDescription', {
                            url: primaryUrl,
                          })
                        : t('sidebar.mobileConnection.tailscaleDescription')}
                    </p>
                  </div>
                </div>

                {data?.connectionKind !== 'tailscale' ? (
                  <ol className="mt-3 grid gap-2 text-xs leading-5 text-foreground-muted">
                    {[
                      'sidebar.mobileConnection.tailscaleStep1',
                      'sidebar.mobileConnection.tailscaleStep2',
                      'sidebar.mobileConnection.tailscaleStep3',
                    ].map((key, index) => (
                      <li key={key} className="flex gap-2">
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-background-quaternary-1 font-mono text-[10px] text-foreground">
                          {index + 1}
                        </span>
                        <span>{t(key)}</span>
                      </li>
                    ))}
                  </ol>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void rpc.app.openExternal(TAILSCALE_DOWNLOAD_URL)}
                  >
                    <ExternalLink className="size-3.5" />
                    {t('sidebar.mobileConnection.downloadTailscale')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void rpc.app.openExternal(TAILSCALE_SETUP_URL)}
                  >
                    <ExternalLink className="size-3.5" />
                    {t('sidebar.mobileConnection.tailscaleSetupGuide')}
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-background p-4">
                <StepIndicator
                  steps={[
                    {
                      title: isDevView
                        ? t('sidebar.mobileConnection.localExpoTitle')
                        : t('sidebar.mobileConnection.installTitle'),
                      label: t('sidebar.mobileConnection.stepLabel', { n: 1 }),
                    },
                    {
                      title: t('sidebar.mobileConnection.connectTitle'),
                      label: t('sidebar.mobileConnection.stepLabel', { n: 2 }),
                    },
                  ]}
                  current={stepIndex}
                  onSelect={setStepIndex}
                />

                <div className="mt-5 flex flex-col items-center gap-4">
                  {stepIndex === 0 ? (
                    <>
                      <p className="max-w-sm text-center text-xs leading-5 text-foreground-muted">
                        {isDevView
                          ? t('sidebar.mobileConnection.localExpoDescription')
                          : t('sidebar.mobileConnection.installDescription')}
                      </p>
                      <QRBox
                        value={isDevView ? localExpoUrl : installUrl || null}
                        disabledLabel={
                          isDevView
                            ? t('sidebar.mobileConnection.localExpoUnavailable')
                            : t('sidebar.mobileConnection.installUnavailable')
                        }
                      />
                      <div className="w-full">
                        {isDevView ? (
                          <InfoRow
                            label={t('sidebar.mobileConnection.localExpoUrl')}
                            value={localExpoUrl ?? t('common.loading')}
                            copyLabel={t('sidebar.mobileConnection.copyLocalExpoUrl')}
                            disabled={!localExpoUrl}
                          />
                        ) : (
                          <InfoRow
                            label={t('sidebar.mobileConnection.installUrl')}
                            value={installUrl || t('common.loading')}
                            copyLabel={t('sidebar.mobileConnection.installTitle')}
                            disabled={!installUrl}
                          />
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="max-w-sm text-center text-xs leading-5 text-foreground-muted">
                        {data?.connectionKind === 'tailscale'
                          ? t('sidebar.mobileConnection.tailscaleConnectDescription')
                          : t('sidebar.mobileConnection.connectDescription')}
                      </p>
                      <QRBox
                        value={isReady ? pairingUrl : null}
                        disabledLabel={t('sidebar.mobileConnection.connectUnavailable')}
                      />
                      <div className="flex w-full items-start gap-2 rounded-lg border border-border bg-background-quaternary-1 px-3 py-2 text-xs leading-5 text-foreground-muted">
                        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                        <span>{t('sidebar.mobileConnection.securityNote')}</span>
                      </div>
                      <Collapsible className="w-full">
                        <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-xs text-foreground-muted hover:text-foreground">
                          <span>{t('sidebar.mobileConnection.advancedDetails')}</span>
                          <ChevronDown className="size-4 transition-transform group-data-[panel-open]:rotate-180" />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="mt-2 grid gap-2">
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
                                    onClick={() =>
                                      copy(url, t('common.copied'), t('common.copyFailed'))
                                    }
                                  >
                                    {url}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    </>
                  )}
                </div>

                <div className="mt-5 flex items-center justify-between">
                  {stepIndex > 0 ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setStepIndex(0)}>
                      <ChevronLeft className="size-4" />
                      {t('common.back')}
                    </Button>
                  ) : (
                    <span />
                  )}
                  {stepIndex === 0 ? (
                    <Button type="button" size="sm" onClick={() => setStepIndex(1)}>
                      {t('common.next')}
                      <ChevronRight className="size-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function MobileTitlebar() {
  return <Titlebar />;
}

export function MobileMainPanel() {
  return <MobileView />;
}

export const mobileView = {
  TitlebarSlot: MobileTitlebar,
  MainPanel: MobileMainPanel,
};
