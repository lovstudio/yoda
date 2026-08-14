import { Loader2 } from 'lucide-react';
import { useId, type ReactNode } from 'react';

type SessionOpeningPresentation = 'loading' | 'detail';

export function SessionOpeningSurface({
  surface = 'task-session-opening',
  title,
  heading,
  description,
  progressMessage,
  summary,
  statusIcon,
  actions,
  presentation = 'loading',
}: {
  surface?: string;
  title?: string;
  heading: string;
  description?: string;
  progressMessage: string;
  summary?: ReactNode;
  statusIcon?: ReactNode;
  actions?: ReactNode;
  presentation?: SessionOpeningPresentation;
}) {
  if (presentation === 'loading') {
    return (
      <div
        data-yoda-surface={surface}
        data-session-opening-presentation="brand"
        role="status"
        aria-live="polite"
        aria-busy="true"
        aria-label={progressMessage}
        className="flex h-full min-h-0 w-full min-w-0 items-center justify-center overflow-hidden bg-[var(--xterm-bg)]"
      >
        <YodaOpeningMark />
      </div>
    );
  }

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
            {statusIcon ?? (
              <Loader2
                className="ml-auto size-3.5 shrink-0 animate-spin text-foreground-passive"
                aria-hidden
              />
            )}
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
                  {actions ? (
                    <div className="mt-3 flex items-center justify-center gap-2">{actions}</div>
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

function YodaOpeningMark() {
  const id = useId().replace(/:/g, '');
  const maskId = `session-opening-cowl-${id}`;
  const glowId = `session-opening-glow-${id}`;

  return (
    <svg
      data-yoda-opening-mark
      viewBox="0 0 240 220"
      className="yoda-session-opening-mark w-[72px] text-foreground"
      aria-hidden
      focusable="false"
    >
      <defs>
        <radialGradient id={glowId} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="var(--yoda-opening-presence)" stopOpacity="0.55" />
          <stop offset="1" stopColor="var(--yoda-opening-presence)" stopOpacity="0" />
        </radialGradient>
        <mask id={maskId}>
          <rect x="-60" y="-60" width="360" height="380" fill="#fff" />
          <path fill="#000" d="M 167.2 120.4 A 50 50 0 1 0 72.8 120.4 L 120 256 Z" />
        </mask>
      </defs>
      <path
        mask={`url(#${maskId})`}
        fill="currentColor"
        d="M 156.4 21.3 L 228.2 162.9 A 34 34 0 0 1 200 216 L 40 216 A 34 34 0 0 1 11.8 162.9 L 83.6 21.3 A 44 44 0 0 1 156.4 21.3 Z"
      />
      <circle
        className="yoda-session-opening-glow"
        cx="120"
        cy="104"
        r="36"
        fill={`url(#${glowId})`}
      />
      <circle
        className="yoda-session-opening-dot"
        cx="120"
        cy="104"
        r="13"
        fill="var(--yoda-opening-presence)"
      />
    </svg>
  );
}
