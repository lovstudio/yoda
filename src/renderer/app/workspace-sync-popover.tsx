import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cloud, Copy, RefreshCw, Smartphone, Wifi } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MOBILE_SYNC_MODES, type MobileSyncMode } from '@shared/mobile-sync';
import {
  WORKSPACE_BAR_CARD_CLASS,
  WorkspaceBarCardHeader,
  WorkspaceBarCardSection,
} from '@renderer/app/workspace-bar-card';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { RadioGroup, RadioGroupItem } from '@renderer/lib/ui/radio-group';
import { cn } from '@renderer/utils/utils';

const SYNC_MODE_ICONS: Record<MobileSyncMode, typeof Wifi> = {
  lan: Wifi,
  relay: Cloud,
  both: Smartphone,
};

function StatusLine({ tone, children }: { tone: 'ok' | 'idle' | 'warn'; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-[11px] leading-4',
        tone === 'ok' && 'text-foreground',
        tone === 'idle' && 'text-foreground-passive',
        tone === 'warn' && 'text-destructive'
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          tone === 'ok' && 'bg-success',
          tone === 'idle' && 'bg-foreground-passive/50',
          tone === 'warn' && 'bg-destructive'
        )}
      />
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

export function WorkspaceSyncPopover({
  open,
  onOpenChange,
  triggerClassName,
  labelClassName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerClassName: string;
  labelClassName: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const syncMode = useQuery({
    queryKey: ['mobileGateway', 'syncMode'],
    queryFn: () => rpc.mobileGateway.getSyncMode(),
    enabled: open,
  });
  const connectionInfo = useQuery({
    queryKey: ['mobileGateway', 'connectionInfo'],
    queryFn: () => rpc.mobileGateway.getConnectionInfo(),
    enabled: open,
  });
  const relayStatus = useQuery({
    queryKey: ['mobileGateway', 'relayStatus'],
    queryFn: () => rpc.mobileGateway.getRelayStatus(),
    enabled: open,
  });

  const setMode = useMutation({
    mutationFn: (mode: MobileSyncMode) => rpc.mobileGateway.setSyncMode(mode),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mobileGateway'] });
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : String(error));
    },
  });

  const mode = syncMode.data ?? 'both';
  const ModeIcon = SYNC_MODE_ICONS[mode];
  const lanUrl = connectionInfo.data?.urls[0] ?? null;
  const relay = relayStatus.data;
  // Surfaced with a copy button, because a relay handshake failure is the one
  // status here a user will want to paste somewhere to get help with.
  const relayError =
    mode !== 'lan' && relay?.configured && !relay.connected ? relay.lastError : null;

  const copyToClipboard = (value: string, successKey: string) => {
    void navigator.clipboard
      ?.writeText(value)
      .then(() => toast.success(t(successKey)))
      .catch(() => toast.error(t('workspaceRuntime.sync.lanUrlCopyFailed')));
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        aria-label={t('workspaceRuntime.sync.title')}
        className={cn(triggerClassName, open && 'bg-background-2 text-foreground')}
        title={t('workspaceRuntime.sync.title')}
      >
        <ModeIcon className="size-3.5" />
        <span className={labelClassName}>{t('workspaceRuntime.sync.title')}</span>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        className={cn(WORKSPACE_BAR_CARD_CLASS, 'w-80')}
      >
        <WorkspaceBarCardHeader
          icon={Smartphone}
          title={t('workspaceRuntime.sync.title')}
          description={t('workspaceRuntime.sync.description')}
        />
        <WorkspaceBarCardSection>
          <RadioGroup
            value={mode}
            onValueChange={(value) => setMode.mutate(value as MobileSyncMode)}
            disabled={setMode.isPending || syncMode.isLoading}
            aria-label={t('workspaceRuntime.sync.title')}
          >
            {MOBILE_SYNC_MODES.map((candidate) => (
              <label key={candidate} className="flex cursor-pointer items-start gap-2.5">
                <RadioGroupItem value={candidate} className="mt-0.5" />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-xs text-foreground">
                    {t(`workspaceRuntime.sync.modes.${candidate}.label`)}
                  </span>
                  <span className="text-[11px] leading-4 text-foreground-passive">
                    {t(`workspaceRuntime.sync.modes.${candidate}.description`)}
                  </span>
                </div>
              </label>
            ))}
          </RadioGroup>
        </WorkspaceBarCardSection>
        <WorkspaceBarCardSection label={t('workspaceRuntime.sync.statusLabel')}>
          <div className="flex flex-col gap-2">
            <div className="flex min-w-0 items-center justify-between gap-2">
              {connectionInfo.data?.lanSyncEnabled ? (
                <StatusLine tone={lanUrl ? 'ok' : 'warn'}>
                  {lanUrl ?? t('workspaceRuntime.sync.lanNoAddress')}
                </StatusLine>
              ) : (
                <StatusLine tone="idle">{t('workspaceRuntime.sync.lanOff')}</StatusLine>
              )}
              {lanUrl ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => copyToClipboard(lanUrl, 'workspaceRuntime.sync.lanUrlCopied')}
                  title={t('workspaceRuntime.sync.copyLanUrl')}
                  aria-label={t('workspaceRuntime.sync.copyLanUrl')}
                >
                  <Copy aria-hidden className="size-3" />
                </Button>
              ) : null}
            </div>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <StatusLine
                tone={
                  mode === 'lan'
                    ? 'idle'
                    : relay?.connected
                      ? 'ok'
                      : relay?.configured
                        ? 'warn'
                        : 'idle'
                }
              >
                {mode === 'lan'
                  ? t('workspaceRuntime.sync.relayOff')
                  : relay?.connected
                    ? t('workspaceRuntime.sync.relayConnected')
                    : relay?.configured
                      ? (relayError ?? t('workspaceRuntime.sync.relayConnecting'))
                      : t('workspaceRuntime.sync.relayNotPaired')}
              </StatusLine>
              {relayError ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() =>
                    copyToClipboard(relayError, 'workspaceRuntime.sync.relayErrorCopied')
                  }
                  title={t('workspaceRuntime.sync.copyRelayError')}
                  aria-label={t('workspaceRuntime.sync.copyRelayError')}
                >
                  <Copy aria-hidden className="size-3" />
                </Button>
              ) : null}
            </div>
          </div>
        </WorkspaceBarCardSection>
        <WorkspaceBarCardSection className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ['mobileGateway'] });
            }}
          >
            <RefreshCw aria-hidden className="size-3" />
            {t('workspaceRuntime.sync.refresh')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              onOpenChange(false);
              appState.sidePane.pinView('settings', { tab: 'mobile' });
            }}
          >
            {t('workspaceRuntime.sync.openPairing')}
          </Button>
        </WorkspaceBarCardSection>
      </PopoverContent>
    </Popover>
  );
}
