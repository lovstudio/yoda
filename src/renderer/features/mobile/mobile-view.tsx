import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  ChevronDown,
  Cloud,
  Copy,
  ExternalLink,
  FlaskConical,
  LogIn,
  Network,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  WifiOff,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { toast } from '@renderer/lib/hooks/use-toast';
import {
  useAccountAuthWarmUp,
  useAccountSession,
  useAccountSignIn,
} from '@renderer/lib/hooks/useAccount';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@renderer/lib/ui/collapsible';
import { cn } from '@renderer/utils/utils';
import {
  deriveRelayConnectionUiState,
  hasReachableLocalGateway,
  type RelayConnectionPhase,
} from './mobile-connection-state';

const TAILSCALE_DOWNLOAD_URL = 'https://tailscale.com/download';
const TAILSCALE_SETUP_URL = 'https://tailscale.com/kb/1017/install';

function userFacingError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');
}

async function copyToClipboard(value: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error('Clipboard is not available');
  await navigator.clipboard.writeText(value);
}

function copy(value: string, successMessage: string, failureMessage: string): void {
  void copyToClipboard(value)
    .then(() => toast.success(successMessage))
    .catch(() => toast.error(failureMessage));
}

function QRBox({
  value,
  label,
  disabledLabel,
}: {
  value: string | null;
  label: string;
  disabledLabel: string;
}) {
  return (
    <div className="flex aspect-square w-[204px] max-w-full items-center justify-center rounded-xl border border-border bg-white p-3 shadow-xs">
      {value ? (
        <QRCodeSVG
          value={value}
          size={180}
          marginSize={2}
          bgColor="#ffffff"
          fgColor="#171717"
          title={label}
          className="h-auto max-w-full"
        />
      ) : (
        <div className="flex max-w-36 flex-col items-center gap-3 text-center text-xs leading-5 text-foreground-muted">
          <Smartphone className="size-6" />
          <span>{disabledLabel}</span>
        </div>
      )}
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

function relayStatusLabel(phase: RelayConnectionPhase, t: (key: string) => string): string {
  switch (phase) {
    case 'loading':
      return t('sidebar.mobileConnection.relayChecking');
    case 'gateway-unavailable':
      return t('sidebar.mobileConnection.gatewayUnavailableForRelay');
    case 'account-unavailable':
      return t('sidebar.mobileConnection.accountStatusLoadFailed');
    case 'load-error':
      return t('sidebar.mobileConnection.relayStatusLoadFailed');
    case 'needs-sign-in':
      return t('sidebar.mobileConnection.relayNeedsSignIn');
    case 'needs-enable':
      return t('sidebar.mobileConnection.relayNotEnabled');
    case 'connecting':
      return t('sidebar.mobileConnection.relayConnecting');
    case 'offline':
      return t('sidebar.mobileConnection.relayDisconnected');
    case 'pairing-ready':
      return t('sidebar.mobileConnection.relayPairingReady');
    case 'pairing-expired':
      return t('sidebar.mobileConnection.relayPairingExpired');
    case 'ready':
      return t('sidebar.mobileConnection.relayConnected');
  }
}

function localizedConnectionError(error: unknown, t: (key: string) => string): string {
  const message = userFacingError(error);
  if (message.includes('Yoda Relay credential was rejected')) {
    return t('sidebar.mobileConnection.relayCredentialRejected');
  }
  if (message.includes('Yoda Relay Pass is not active')) {
    return t('sidebar.mobileConnection.relayPassInactive');
  }
  if (message.includes('Yoda Relay was connected by another Yoda instance')) {
    return t('sidebar.mobileConnection.relayReplaced');
  }
  if (message.includes('Relay device is unavailable')) {
    return t('sidebar.mobileConnection.relayDeviceUnavailable');
  }
  return message;
}

export function MobileView({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const account = useAccountSession();
  const signIn = useAccountSignIn();
  const showAccountDeviceFlow = useShowModal('accountDeviceFlowModal');
  const gateway = useQuery({
    queryKey: ['mobileGateway', 'connectionInfo'],
    queryFn: () => rpc.mobileGateway.getConnectionInfo(),
    refetchInterval: 5000,
  });
  const relay = useQuery({
    queryKey: ['mobileGateway', 'relayStatus'],
    queryFn: () => rpc.mobileGateway.getRelayStatus(),
    refetchInterval: 3000,
  });
  const [relayBusy, setRelayBusy] = useState(false);
  const [relayError, setRelayError] = useState<string | null>(null);
  const [showFallbackQr, setShowFallbackQr] = useState(false);
  const [showDeveloperQr, setShowDeveloperQr] = useState(false);
  const isAccountSignedIn = account.data?.isSignedIn === true;

  useAccountAuthWarmUp(!account.isLoading && !account.error && !isAccountSignedIn);

  const data = gateway.data;
  const primaryUrl = data?.urls[0] ?? (data ? `http://localhost:${data.port}` : '');
  const localExpoUrl = data?.localExpoUrl ?? null;
  const installUrl = data?.installUrl ?? '';
  const localPairingUrl = data?.pairingUrl ?? null;
  const isLocalReady = hasReachableLocalGateway(data);
  const reachableLocalPairingUrl = isLocalReady ? localPairingUrl : null;
  const isDevelopmentBuild = data?.mode === 'development';
  const relayState = deriveRelayConnectionUiState({
    gatewayLoading: gateway.isLoading,
    gatewayReady: Boolean(data?.running && data.token),
    accountLoading: account.isLoading,
    accountUnavailable: Boolean(!account.data && account.error),
    isSignedIn: isAccountSignedIn,
    relayLoading: relay.isLoading,
    relayUnavailable: Boolean(!relay.data && relay.error),
    relay: relay.data,
  });
  const relayIsHealthy = relayState.phase === 'ready' || relayState.phase === 'pairing-ready';
  const relayIsPending = relayState.phase === 'loading' || relayState.phase === 'connecting';
  const rawConnectionError =
    relayError ?? relay.error ?? account.error ?? relay.data?.lastError ?? null;
  const relayErrorText = rawConnectionError
    ? account.error === rawConnectionError
      ? t('sidebar.mobileConnection.accountStatusLoadFailed')
      : localizedConnectionError(rawConnectionError, t)
    : null;
  const relayErrorCopyText = rawConnectionError ? userFacingError(rawConnectionError) : null;

  const localDetails = useMemo(() => {
    if (!data) return '';
    const lines = [
      `${t('sidebar.mobileConnection.gatewayUrl')}: ${primaryUrl}`,
      `${t('sidebar.mobileConnection.token')}: ${data.token ?? ''}`,
      `${t('sidebar.mobileConnection.pairingUrl')}: ${localPairingUrl ?? ''}`,
    ];
    if (isDevelopmentBuild) {
      lines.unshift(`${t('sidebar.mobileConnection.localExpoUrl')}: ${localExpoUrl ?? ''}`);
    }
    return lines.join('\n');
  }, [data, isDevelopmentBuild, localExpoUrl, localPairingUrl, primaryUrl, t]);

  const retryAll = async () => {
    setRelayError(null);
    await Promise.all([gateway.refetch(), relay.refetch(), account.refetch()]);
  };

  const enableRelay = async () => {
    setRelayBusy(true);
    setRelayError(null);
    try {
      if (!isAccountSignedIn) {
        showAccountDeviceFlow({
          onError: (message: string) => setRelayError(message),
        });
        const result = await signIn.mutateAsync(undefined);
        if (!result.success) {
          throw new Error(result.error || t('sidebar.mobileConnection.relaySignInRequired'));
        }
      }
      await rpc.mobileGateway.enableRelay();
      await relay.refetch();
    } catch (nextError) {
      const message = userFacingError(nextError);
      if (message.includes('Sign in to your LovStudio account')) {
        await account.refetch();
        setRelayError(t('sidebar.mobileConnection.relaySignInRequired'));
      } else {
        setRelayError(message);
      }
    } finally {
      setRelayBusy(false);
    }
  };

  const createRelayPairing = async () => {
    setRelayBusy(true);
    setRelayError(null);
    try {
      await rpc.mobileGateway.createRelayPairing();
      await relay.refetch();
    } catch (nextError) {
      setRelayError(userFacingError(nextError));
    } finally {
      setRelayBusy(false);
    }
  };

  const relayAction = (() => {
    if (
      relayState.phase === 'load-error' ||
      relayState.phase === 'gateway-unavailable' ||
      relayState.phase === 'account-unavailable'
    ) {
      return (
        <Button type="button" onClick={() => void retryAll()} disabled={relay.isFetching}>
          <RefreshCw className={cn('size-4', relay.isFetching && 'animate-spin')} />
          {t('common.retry')}
        </Button>
      );
    }
    if (relayState.phase === 'loading' || relayState.phase === 'connecting') {
      return null;
    }
    if (relayState.phase === 'needs-sign-in' || relayState.phase === 'needs-enable') {
      return (
        <Button
          type="button"
          onClick={() => void enableRelay()}
          disabled={relayBusy || account.isLoading}
        >
          {relayState.phase === 'needs-sign-in' ? (
            <LogIn className="size-4" />
          ) : (
            <Cloud className="size-4" />
          )}
          {relayBusy
            ? signIn.isPending
              ? t('sidebar.mobileConnection.relaySigningIn')
              : t('sidebar.mobileConnection.relayEnabling')
            : relayState.phase === 'needs-sign-in'
              ? t('sidebar.mobileConnection.signInToEnableRelay')
              : t('sidebar.mobileConnection.enableRelay')}
        </Button>
      );
    }
    if (relayState.phase === 'offline') {
      return (
        <Button type="button" onClick={() => void enableRelay()} disabled={relayBusy}>
          <RefreshCw className={cn('size-4', relayBusy && 'animate-spin')} />
          {relayBusy
            ? t('sidebar.mobileConnection.relayConnecting')
            : t('sidebar.mobileConnection.reconnectRelay')}
        </Button>
      );
    }
    if (relayState.phase === 'pairing-ready') return null;
    return (
      <Button type="button" onClick={() => void createRelayPairing()} disabled={relayBusy}>
        {relayBusy ? (
          <RefreshCw className="size-4 animate-spin" />
        ) : (
          <Smartphone className="size-4" />
        )}
        {relayBusy
          ? t('sidebar.mobileConnection.relayPairingGenerating')
          : relayState.phase === 'ready'
            ? t('sidebar.mobileConnection.generateRelayPairing')
            : t('sidebar.mobileConnection.regenerateRelayPairing')}
      </Button>
    );
  })();

  return (
    <div
      className={cn(
        '@container flex flex-col bg-background text-foreground',
        !embedded && 'h-full min-h-0'
      )}
    >
      {!embedded ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-6 py-3">
          <Smartphone className="size-4 shrink-0 text-foreground-muted" />
          <h1 className="truncate text-sm font-medium">{t('sidebar.mobileConnection.title')}</h1>
        </div>
      ) : null}

      <div className={cn(!embedded && 'min-h-0 flex-1 overflow-y-auto')}>
        <div
          className={cn('flex w-full flex-col gap-4', embedded ? 'py-4' : 'mx-auto max-w-4xl p-6')}
        >
          {gateway.error ? (
            <div
              role="alert"
              className="flex items-center gap-3 rounded-lg border border-border-destructive bg-background-destructive px-3 py-2 text-xs text-foreground-destructive"
            >
              <WifiOff className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                {gateway.data
                  ? t('sidebar.mobileConnection.gatewayRefreshFailed')
                  : t('sidebar.mobileConnection.loadFailed')}
              </span>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => void retryAll()}
                disabled={gateway.isFetching || relay.isFetching}
              >
                <RefreshCw
                  className={cn(
                    'size-3',
                    (gateway.isFetching || relay.isFetching) && 'animate-spin'
                  )}
                />
                {t('common.retry')}
              </Button>
            </div>
          ) : null}

          <section className="overflow-hidden rounded-xl border border-border bg-background shadow-xs">
            <div className="grid gap-6 p-5 @3xl:grid-cols-[minmax(0,1fr)_220px] @3xl:items-center">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-foreground text-background">
                    <Cloud className="size-4.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {t('sidebar.mobileConnection.relayTitle')}
                    </div>
                  </div>
                </div>

                <h2 className="mt-5 text-xl font-medium tracking-tight text-foreground">
                  {t('sidebar.mobileConnection.relayHeroTitle')}
                </h2>
                <p className="mt-2 max-w-lg text-sm leading-6 text-foreground-muted">
                  {t('sidebar.mobileConnection.relayHeroDescription')}
                </p>

                <div
                  role="status"
                  aria-live="polite"
                  className={cn(
                    'mt-4 inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium',
                    relayIsHealthy
                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : relayIsPending
                        ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                        : 'bg-background-quaternary-1 text-foreground-muted'
                  )}
                >
                  {relayIsHealthy ? (
                    <CheckCircle2 className="size-3.5" />
                  ) : relayIsPending ? (
                    <RefreshCw className="size-3.5 animate-spin" />
                  ) : (
                    <span className="size-1.5 rounded-full bg-current opacity-70" />
                  )}
                  {relayStatusLabel(relayState.phase, t)}
                </div>

                {relayErrorText ? (
                  <div
                    role="alert"
                    className="mt-4 flex items-start gap-2 rounded-lg border border-border-destructive bg-background-destructive px-3 py-2 text-xs leading-5 text-foreground-destructive"
                  >
                    <WifiOff className="mt-0.5 size-4 shrink-0" />
                    <span className="min-w-0 flex-1 break-words">{relayErrorText}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t('sidebar.mobileConnection.copyRelayError')}
                      onClick={() =>
                        copy(
                          relayErrorCopyText ?? relayErrorText,
                          t('common.copied'),
                          t('common.copyFailed')
                        )
                      }
                    >
                      <Copy className="size-3" />
                    </Button>
                  </div>
                ) : null}

                {relayState.phase === 'pairing-expired' ? (
                  <p className="mt-3 text-xs leading-5 text-amber-700 dark:text-amber-300">
                    {t('sidebar.mobileConnection.relayPairingExpiredHint')}
                  </p>
                ) : null}

                {relayAction ? <div className="mt-5">{relayAction}</div> : null}
                {relayState.phase === 'needs-sign-in' || relayState.phase === 'needs-enable' ? (
                  <p className="mt-3 max-w-lg text-xs leading-5 text-foreground-tertiary-passive">
                    {t('sidebar.mobileConnection.relayTrialNote')}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col items-center gap-3 @3xl:justify-self-end">
                <QRBox
                  value={relayState.pairingUrl}
                  label={t('sidebar.mobileConnection.relayPairingQrLabel')}
                  disabledLabel={
                    relayState.phase === 'pairing-expired'
                      ? t('sidebar.mobileConnection.relayPairingExpiredQr')
                      : t('sidebar.mobileConnection.relayPairingPlaceholder')
                  }
                />
                {relayState.pairingUrl ? (
                  <>
                    <p className="text-center text-xs leading-5 text-foreground-muted">
                      {t('sidebar.mobileConnection.scanRelayPairing')}
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() =>
                          copy(
                            relayState.pairingUrl ?? '',
                            t('common.copied'),
                            t('common.copyFailed')
                          )
                        }
                      >
                        <Copy className="size-3" />
                        {t('sidebar.mobileConnection.copyRelayPairing')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={relayBusy}
                        onClick={() => void createRelayPairing()}
                      >
                        <RefreshCw className={cn('size-3', relayBusy && 'animate-spin')} />
                        {relayBusy
                          ? t('sidebar.mobileConnection.relayPairingGenerating')
                          : t('sidebar.mobileConnection.regenerateRelayPairing')}
                      </Button>
                    </div>
                  </>
                ) : null}
              </div>
            </div>

            <div className="flex items-start gap-2 border-t border-border/70 bg-background-quaternary-1/45 px-5 py-3 text-xs leading-5 text-foreground-muted">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" />
              <span>{t('sidebar.mobileConnection.relaySecurityNote')}</span>
            </div>

            <Collapsible>
              <CollapsibleTrigger className="group flex w-full items-center gap-3 border-t border-border/70 px-5 py-3.5 text-left hover:bg-background-1">
                <Smartphone className="size-4 shrink-0 text-foreground-muted" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {t('sidebar.mobileConnection.installDisclosureTitle')}
                  </div>
                  <div className="mt-0.5 text-xs text-foreground-muted">
                    {t('sidebar.mobileConnection.installDisclosureDescription')}
                  </div>
                </div>
                <ChevronDown className="size-4 shrink-0 text-foreground-muted transition-transform group-data-[panel-open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="grid gap-5 border-t border-border/70 p-5 @3xl:grid-cols-[204px_minmax(0,1fr)] @3xl:items-center">
                  <QRBox
                    value={installUrl || null}
                    label={t('sidebar.mobileConnection.installQrLabel')}
                    disabledLabel={t('sidebar.mobileConnection.installUnavailable')}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {t('sidebar.mobileConnection.installTitle')}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-foreground-muted">
                      {t('sidebar.mobileConnection.installDescription')}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      disabled={!installUrl}
                      onClick={() => copy(installUrl, t('common.copied'), t('common.copyFailed'))}
                    >
                      <Copy className="size-3.5" />
                      {t('sidebar.mobileConnection.copyInstallUrl')}
                    </Button>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </section>

          <Collapsible>
            <CollapsibleTrigger className="group flex w-full items-center gap-3 rounded-xl border border-border bg-background px-4 py-3.5 text-left hover:bg-background-1 data-[panel-open]:rounded-b-none">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background-quaternary-1 text-foreground-muted">
                <Network className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {t('sidebar.mobileConnection.alternativeConnections')}
                </div>
                <div className="mt-0.5 text-xs text-foreground-muted">
                  {t('sidebar.mobileConnection.alternativeConnectionsDescription')}
                </div>
              </div>
              {data?.connectionKind === 'tailscale' ? (
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                  {t('sidebar.mobileConnection.tailscaleDetected')}
                </span>
              ) : null}
              <ChevronDown className="size-4 shrink-0 text-foreground-muted transition-transform group-data-[panel-open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="overflow-hidden rounded-b-xl border-x border-b border-border bg-background">
                <div className="p-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background-quaternary-1 text-foreground-muted">
                      <Network className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-medium">
                          {t('sidebar.mobileConnection.fallbackConnectionTitle')}
                        </div>
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[10px] font-medium',
                            isLocalReady
                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                              : 'bg-background-quaternary-1 text-foreground-muted'
                          )}
                        >
                          {isLocalReady
                            ? data?.connectionKind === 'tailscale'
                              ? t('sidebar.mobileConnection.tailscaleReady')
                              : t('sidebar.mobileConnection.localReady')
                            : gateway.isLoading
                              ? t('common.loading')
                              : t('sidebar.mobileConnection.notReady')}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-foreground-muted">
                        {data?.connectionKind === 'local'
                          ? t('sidebar.mobileConnection.fallbackUnavailableDescription')
                          : data?.connectionKind === 'tailscale'
                            ? t('sidebar.mobileConnection.fallbackTailscaleDescription')
                            : t('sidebar.mobileConnection.fallbackLanDescription')}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!isLocalReady}
                      onClick={() => setShowFallbackQr((current) => !current)}
                    >
                      <Smartphone className="size-3.5" />
                      {showFallbackQr
                        ? t('sidebar.mobileConnection.hideFallbackQr')
                        : t('sidebar.mobileConnection.showFallbackQr')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
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

                  {showFallbackQr ? (
                    <div className="mt-4 grid gap-4 rounded-xl bg-background-quaternary-1 p-4 @3xl:grid-cols-[204px_minmax(0,1fr)] @3xl:items-center">
                      <QRBox
                        value={reachableLocalPairingUrl}
                        label={t('sidebar.mobileConnection.fallbackQrLabel')}
                        disabledLabel={t('sidebar.mobileConnection.connectUnavailable')}
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium">
                          {t('sidebar.mobileConnection.connectTitle')}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-foreground-muted">
                          {data?.connectionKind === 'tailscale'
                            ? t('sidebar.mobileConnection.tailscaleConnectDescription')
                            : t('sidebar.mobileConnection.connectDescription')}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-3"
                          disabled={!reachableLocalPairingUrl}
                          onClick={() =>
                            copy(
                              reachableLocalPairingUrl ?? '',
                              t('common.copied'),
                              t('common.copyFailed')
                            )
                          }
                        >
                          <Copy className="size-3.5" />
                          {t('sidebar.mobileConnection.copyFallbackPairing')}
                        </Button>
                        <div className="mt-3 flex items-start gap-2 text-xs leading-5 text-foreground-muted">
                          <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                          <span>{t('sidebar.mobileConnection.securityNote')}</span>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                {isDevelopmentBuild ? (
                  <div className="border-t border-border/70 p-4">
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background-quaternary-1 text-foreground-muted">
                        <FlaskConical className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">
                          {t('sidebar.mobileConnection.developerConnectionTitle')}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-foreground-muted">
                          {t('sidebar.mobileConnection.localExpoDescription')}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!localExpoUrl}
                        onClick={() => setShowDeveloperQr((current) => !current)}
                      >
                        {showDeveloperQr
                          ? t('sidebar.mobileConnection.hideDeveloperQr')
                          : t('sidebar.mobileConnection.showDeveloperQr')}
                      </Button>
                    </div>
                    {showDeveloperQr ? (
                      <div className="mt-4 grid gap-4 rounded-xl bg-background-quaternary-1 p-4 @3xl:grid-cols-[204px_minmax(0,1fr)] @3xl:items-center">
                        <QRBox
                          value={localExpoUrl}
                          label={t('sidebar.mobileConnection.developerQrLabel')}
                          disabledLabel={t('sidebar.mobileConnection.localExpoUnavailable')}
                        />
                        <InfoRow
                          label={t('sidebar.mobileConnection.localExpoUrl')}
                          value={localExpoUrl ?? t('common.loading')}
                          copyLabel={t('sidebar.mobileConnection.copyLocalExpoUrl')}
                          disabled={!localExpoUrl}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <Collapsible>
                  <CollapsibleTrigger className="group flex w-full items-center gap-3 border-t border-border/70 px-4 py-3 text-left hover:bg-background-1">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">
                        {t('sidebar.mobileConnection.connectionDiagnostics')}
                      </div>
                      <div className="mt-0.5 text-xs text-foreground-muted">
                        {data?.running
                          ? t('sidebar.mobileConnection.gatewayOnline')
                          : t('sidebar.mobileConnection.gatewayOffline')}
                      </div>
                    </div>
                    <ChevronDown className="size-4 shrink-0 text-foreground-muted transition-transform group-data-[panel-open]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="grid gap-2 border-t border-border/70 bg-background-quaternary-1/45 p-4">
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs leading-5 text-foreground-muted">
                          {t('sidebar.mobileConnection.localDiagnosticsWarning')}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          disabled={!isLocalReady}
                          onClick={() =>
                            copy(localDetails, t('common.copied'), t('common.copyFailed'))
                          }
                        >
                          <Copy className="size-3" />
                          {t('sidebar.mobileConnection.copyLocalDetails')}
                        </Button>
                      </div>
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
                        <div className="mt-1 grid gap-1">
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
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </CollapsibleContent>
          </Collapsible>
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
