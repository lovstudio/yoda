import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Workspace runtime bar visual rhythm', () => {
  const source = readFileSync(new URL('./workspace-runtime-bar.tsx', import.meta.url), 'utf8');
  const notificationSource = readFileSync(
    new URL('./workspace-notification-center.tsx', import.meta.url),
    'utf8'
  );

  it('uses one consistent compact action geometry', () => {
    expect(source).toContain(
      'relative flex h-6 w-8 shrink-0 items-center justify-center gap-0 rounded-md p-0'
    );
    expect(source).toContain('@min-[1441px]:w-auto');
  });

  it('uses fixed spacing without inserting an oversized group break', () => {
    expect(source).toContain('items-center gap-0.5 overflow-hidden whitespace-nowrap');
    expect(source).not.toContain('workspace-runtime-group-divider');
  });

  it('uses the pressed surface only for open or toggle state', () => {
    expect(source).toContain('isMaasPopoverOpen');
    expect(source).toMatch(/maasPresentation\.active\s+\? 'text-foreground'/);
    expect(source).toContain("terminalActive && 'bg-background-2 text-foreground'");
  });

  it('overlays compact counters instead of widening their action buttons', () => {
    expect(notificationSource).toContain('absolute top-0 right-0');
    expect(notificationSource).toContain('h-3.5 min-w-3.5');
    expect(source).toContain('absolute top-0 right-0 inline-flex h-3.5 min-w-3.5');
    expect(source).toContain('absolute top-1 right-0.5 size-1.5');
    expect(notificationSource).not.toContain('bg-foreground px-1 text-center');
  });
});
