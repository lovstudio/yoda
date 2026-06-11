import { AlertCircle, Check, Copy, ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import yodaLogoWhite from '@/assets/images/yoda/yoda_logo_white.svg';
import yodaLogoDark from '@/assets/images/yoda/yoda_logo.svg';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { Button } from '@renderer/lib/ui/button';
import { Kbd } from '@renderer/lib/ui/kbd';
import { Spinner } from '@renderer/lib/ui/spinner';
import { cn } from '@renderer/utils/utils';

const isMac = navigator.platform.toUpperCase().includes('MAC');

// Shape of a device code (XXXX-XXXX) rendered as placeholder cells while loading.
const CODE_PLACEHOLDER = [
  'cell',
  'cell',
  'cell',
  'cell',
  'dash',
  'cell',
  'cell',
  'cell',
  'cell',
] as const;

interface DeviceFlowPanelProps {
  title: string;
  description: string;
  openLabel: string;
  userCode: string;
  timeRemaining: number;
  copied: boolean;
  browserOpening: boolean;
  browserOpenCountdown: number;
  canOpen: boolean;
  onCopy: () => void;
  onOpen: () => void;
  onCancel: () => void;
  success: { title: string; description?: string; detail?: ReactNode } | null;
  error: { title: string; message: string } | null;
  footer?: ReactNode;
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function DeviceFlowPanel({
  title,
  description,
  openLabel,
  userCode,
  timeRemaining,
  copied,
  browserOpening,
  browserOpenCountdown,
  canOpen,
  onCopy,
  onOpen,
  onCancel,
  success,
  error,
  footer,
}: DeviceFlowPanelProps) {
  const { t } = useTranslation();
  const { effectiveTheme } = useTheme();
  const logo = effectiveTheme === 'ydark' ? yodaLogoWhite : yodaLogoDark;
  const loading = !userCode;

  if (success) {
    return (
      <div className="flex flex-col items-center px-6 py-12 duration-300 animate-in fade-in zoom-in-95">
        <div className="flex size-12 items-center justify-center rounded-full bg-green-500/15">
          <Check className="size-6 text-green-500" strokeWidth={2.5} />
        </div>
        <h2 className="mt-5 text-lg font-semibold">{success.title}</h2>
        {success.description && (
          <p className="mt-1 text-sm text-muted-foreground">{success.description}</p>
        )}
        {success.detail && <div className="mt-4">{success.detail}</div>}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center px-6 py-10">
        <div className="flex size-12 items-center justify-center rounded-full bg-background-destructive">
          <AlertCircle className="size-6 text-foreground-destructive" />
        </div>
        <h2 className="mt-5 text-lg font-semibold">{error.title}</h2>
        <p className="mt-1 w-full text-center text-sm break-words text-muted-foreground">
          {error.message}
        </p>
        <Button onClick={onCancel} variant="outline" className="mt-6 w-full">
          {t('common.close')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <div className="flex w-full flex-col items-center px-6 pt-10">
        <img src={logo} alt="Yoda" className="mb-7 h-7" />
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-center text-sm text-muted-foreground">{description}</p>

        <button
          type="button"
          onClick={onCopy}
          disabled={loading}
          className={cn(
            'group mt-7 flex w-full flex-col items-center rounded-lg border border-border bg-background py-5 transition-colors outline-none',
            loading
              ? 'cursor-default'
              : 'hover:border-foreground/25 hover:bg-background-1 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'
          )}
        >
          {loading ? (
            <span aria-hidden className="flex h-9 items-center gap-1.5">
              {CODE_PLACEHOLDER.map((cell, i) =>
                cell === 'dash' ? (
                  <span
                    key={i}
                    className="mx-0.5 h-1 w-3 animate-pulse rounded-full bg-foreground/10"
                    style={{ animationDelay: `${i * 100}ms` }}
                  />
                ) : (
                  <span
                    key={i}
                    className="h-8 w-5 animate-pulse rounded-md bg-foreground/10"
                    style={{ animationDelay: `${i * 100}ms` }}
                  />
                )
              )}
            </span>
          ) : (
            <span className="font-mono text-3xl font-semibold tracking-[0.15em] duration-200 animate-in fade-in">
              {userCode}
            </span>
          )}
          <span className="mt-2.5 flex h-4 items-center gap-1.5 text-xs text-muted-foreground">
            {loading ? (
              <>
                <Spinner className="size-3.5" />
                {t('auth.requestingCode')}
              </>
            ) : copied ? (
              <>
                <Check className="size-3.5 text-green-500" />
                {t('auth.alreadyCopied')}
              </>
            ) : (
              <>
                <Copy className="size-3.5 opacity-60 transition-opacity group-hover:opacity-100" />
                {t('auth.clickToCopy')}
              </>
            )}
          </span>
        </button>

        <Button onClick={onOpen} disabled={!canOpen} size="lg" className="mt-3 w-full">
          <ExternalLink />
          {openLabel}
        </Button>

        <div className="mt-5 flex h-4 items-center gap-2 text-xs text-muted-foreground">
          {/* While loading, the code box already narrates the state. */}
          {!loading && (
            <>
              <Spinner className="size-3.5" />
              {browserOpening ? (
                <span>{t('auth.autoOpening', { seconds: browserOpenCountdown })}</span>
              ) : (
                <span>
                  {t('auth.waiting')}
                  {timeRemaining > 0 && ` · ${formatTime(timeRemaining)}`}
                </span>
              )}
            </>
          )}
        </div>

        {footer}
      </div>

      <div className="mt-6 flex w-full items-center justify-center gap-1 border-t border-border bg-background-quaternary-1 py-2">
        <Button
          variant="ghost"
          size="xs"
          onClick={onCopy}
          disabled={loading}
          className="gap-1.5 text-muted-foreground"
        >
          <Kbd>{isMac ? '⌘C' : 'Ctrl+C'}</Kbd>
          {t('auth.shortcutCopy')}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={onOpen}
          disabled={!canOpen}
          className="gap-1.5 text-muted-foreground"
        >
          <Kbd>Enter</Kbd>
          {t('auth.shortcutReopen')}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={onCancel}
          className="gap-1.5 text-muted-foreground"
        >
          <Kbd>Esc</Kbd>
          {t('auth.shortcutCancel')}
        </Button>
      </div>
    </div>
  );
}
