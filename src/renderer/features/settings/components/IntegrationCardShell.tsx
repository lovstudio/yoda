import type { ReactNode } from 'react';

type IntegrationCardShellProps = {
  testId: string;
  icon: ReactNode;
  name: string;
  description: ReactNode;
  actions: ReactNode;
};

export function IntegrationCardShell({
  testId,
  icon,
  name,
  description,
  actions,
}: IntegrationCardShellProps) {
  return (
    <div className="flex h-full min-h-0" data-testid={testId}>
      <div className="flex w-full items-center gap-4 rounded-lg border border-muted bg-muted/20 p-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted/50">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-foreground">{name}</h3>
          <p className="mt-0.5 line-clamp-2 text-sm leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
        {actions}
      </div>
    </div>
  );
}
