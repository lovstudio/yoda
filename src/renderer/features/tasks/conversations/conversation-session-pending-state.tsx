import { Loader2 } from 'lucide-react';

export function ConversationSessionPendingState({
  title,
  heading,
  description,
}: {
  title: string;
  heading: string;
  description: string;
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
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
        </span>
        <div className="mt-3 text-sm font-medium text-foreground">{heading}</div>
        <div className="mt-1 text-xs leading-relaxed text-foreground-passive">{description}</div>
        <div className="mt-3 max-w-full truncate rounded-md border border-border bg-background-secondary px-2.5 py-1.5 text-xs text-foreground-muted">
          {title}
        </div>
      </div>
    </div>
  );
}
