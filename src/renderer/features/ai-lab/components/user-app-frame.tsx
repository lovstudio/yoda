import { useMemo } from 'react';
import type { AiLabUserApp } from '@shared/ai-lab';
import { cn } from '@renderer/utils/utils';
import { applySandboxPolicy } from '../sandbox-policy';

export function UserAppFrame({ app, className }: { app: AiLabUserApp; className?: string }) {
  const source = useMemo(() => applySandboxPolicy(app.html), [app.html]);

  return (
    <iframe
      key={app.updatedAt}
      title={app.name}
      srcDoc={source}
      sandbox="allow-scripts allow-forms allow-modals"
      referrerPolicy="no-referrer"
      className={cn(
        'h-full min-h-[420px] w-full rounded-xl border border-border bg-white shadow-sm',
        className
      )}
    />
  );
}
