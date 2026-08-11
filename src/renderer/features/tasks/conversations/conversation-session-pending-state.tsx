import { AlertCircle, Check, Copy, RotateCcw } from 'lucide-react';
import { SessionOpeningSurface } from '@renderer/features/tasks/components/session-opening-surface';
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
    <SessionOpeningSurface
      surface="conversation-session-pending"
      title={title}
      heading={heading}
      description={description}
      progressMessage={description}
      statusIcon={
        error ? (
          <AlertCircle className="ml-auto size-3.5 text-status-cancelled" aria-hidden />
        ) : undefined
      }
      actions={
        error ? (
          <>
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
          </>
        ) : null
      }
    />
  );
}
