import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

export function SessionOpeningSurface({
  surface = 'task-session-opening',
  title,
  heading,
  description,
  progressMessage,
  summary,
}: {
  surface?: string;
  title?: string;
  heading: string;
  description?: string;
  progressMessage: string;
  summary?: ReactNode;
}) {
  return (
    <div
      data-yoda-surface={surface}
      role="status"
      aria-live="polite"
      className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[var(--xterm-bg)]"
    >
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden px-2 pt-2 pb-2">
        <div className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border/50 bg-background/15 shadow-sm">
          <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-3 py-2">
            <span className="flex size-2 shrink-0 items-center justify-center rounded-full bg-primary/15">
              <span className="size-1 animate-pulse rounded-full bg-primary/80" aria-hidden />
            </span>
            <span className="min-w-0 truncate font-mono text-[11px] text-foreground-muted">
              {heading}
            </span>
            <Loader2
              className="ml-auto size-3.5 shrink-0 animate-spin text-foreground-passive"
              aria-hidden
            />
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {summary ? (
              <div className="mx-auto w-full max-w-3xl p-5 sm:p-7">{summary}</div>
            ) : (
              <div className="flex h-full min-h-[14rem] items-center justify-center p-6">
                <div className="max-w-md text-center">
                  <p className="font-mono text-sm text-foreground-muted">
                    <span className="mr-2 text-primary/70" aria-hidden>
                      ›
                    </span>
                    {description ?? progressMessage}
                  </p>
                  {title ? (
                    <p className="mt-3 max-w-full truncate rounded-md border border-border/50 bg-background-secondary/50 px-2.5 py-1.5 text-xs text-foreground-passive">
                      {title}
                    </p>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2 border-t border-border/30 px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-foreground-passive">
              {progressMessage}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
