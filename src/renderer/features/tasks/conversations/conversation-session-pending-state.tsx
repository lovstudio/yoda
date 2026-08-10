import { AlertCircle, Check, Copy, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@renderer/lib/ui/button';

export type ConversationSessionPendingError = {
  retryLabel: string;
  onRetry: () => void;
  copyDebugLabel: string;
  debugCopiedLabel: string;
  debugCopied: boolean;
  onCopyDebug: () => void;
};

export function ConversationSessionPendingState({
  title,
  heading,
  description,
  error,
}: {
  title: string;
  heading: string;
  description: string;
  error?: ConversationSessionPendingError;
}) {
  return (
    <div
      data-yoda-surface="conversation-session-pending"
      role="status"
      aria-live="polite"
      className="flex h-full min-h-0 w-full flex-1 items-center justify-center bg-background px-6"
    >
      <div className="flex max-w-sm flex-col items-center text-center">
        <span className="flex size-9 items-center justify-center rounded-full bg-background-2">
          {error ? (
            <AlertCircle className="size-4 text-status-cancelled" aria-hidden />
          ) : (
            <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
          )}
        </span>
        <div className="mt-3 text-sm font-medium text-foreground">{heading}</div>
        <div className="mt-1 text-xs leading-relaxed text-foreground-passive">{description}</div>
        <div className="mt-3 max-w-full truncate rounded-md border border-border bg-background-secondary px-2.5 py-1.5 text-xs text-foreground-muted">
          {title}
        </div>
        {error ? (
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={error.onRetry}>
              <RotateCcw className="size-3.5" aria-hidden />
              {error.retryLabel}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={error.onCopyDebug}
              aria-label={error.debugCopied ? error.debugCopiedLabel : error.copyDebugLabel}
              title={error.debugCopied ? error.debugCopiedLabel : error.copyDebugLabel}
            >
              {error.debugCopied ? (
                <Check className="size-3.5 text-status-done" aria-hidden />
              ) : (
                <Copy className="size-3.5" aria-hidden />
              )}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
