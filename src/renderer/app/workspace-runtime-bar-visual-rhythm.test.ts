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
      'flex h-6 min-w-7 shrink-0 items-center justify-center gap-1 rounded-md px-1.5'
    );
  });

  it('uses fixed spacing and a single divider between status and utility actions', () => {
    expect(source).toContain('items-center gap-0.5 overflow-hidden whitespace-nowrap');
    expect(source).toContain('data-slot="workspace-runtime-group-divider"');
    expect(source).toContain('className="mx-1 h-3.5 w-px shrink-0 bg-border/70"');
  });

  it('uses the pressed surface only for open or toggle state', () => {
    expect(source).toContain('isMaasPopoverOpen');
    expect(source).toMatch(/maasPresentation\.active\s+\? 'text-foreground'/);
    expect(source).toContain("terminalActive && 'bg-background-2 text-foreground'");
  });

  it('keeps the notification count legible without a dominant solid badge', () => {
    expect(notificationSource).toContain('bg-foreground/10');
    expect(notificationSource).toContain('h-4 min-w-4');
    expect(notificationSource).not.toContain('bg-foreground px-1 text-center');
  });
});
