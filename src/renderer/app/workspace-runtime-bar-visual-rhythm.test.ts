import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readRuntimeBarSource } from '@renderer/app/runtime-bar/test-helpers/read-bar-source';

describe('Workspace runtime bar visual rhythm', () => {
  const source = readRuntimeBarSource();
  const notificationSource = readFileSync(
    new URL('./workspace-notification-center.tsx', import.meta.url),
    'utf8'
  );

  it('uses one consistent compact action geometry', () => {
    expect(source).toContain(
      'relative flex h-6 w-7 shrink-0 items-center justify-center gap-0 rounded-md p-0'
    );
    expect(source).toContain('@min-[1441px]:w-auto');
  });

  it('extends every trigger hit area to the full row height', () => {
    // A 24px chip in a 32px row leaves dead ground top and bottom, which reads as
    // the trigger ignoring a press. Both geometries share one extension, so no
    // entry can be the odd one out, and the row's own clip clamps it.
    expect(source).toContain(
      "before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']"
    );
    expect(source).toContain('flex h-full min-w-0 items-center gap-0.5 overflow-hidden');
    expect(source).not.toContain('className="flex h-5 ');
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

  it('overlays compact counters against the glyph so they never eat the gutter', () => {
    const indicatorSource = readFileSync(
      new URL('./workspace-bar-action-indicator.tsx', import.meta.url),
      'utf8'
    );

    // The eye measures the gap between ink, not between slots. An indicator
    // pinned to the slot edge lands in the 2px gutter and makes the row read as
    // unevenly spaced, so every indicator anchors to the 14px glyph box.
    expect(indicatorSource).toContain(
      'relative flex size-3.5 shrink-0 items-center justify-center'
    );
    expect(indicatorSource).toContain('absolute -top-1.5 right-0 inline-flex h-3 min-w-3');
    expect(indicatorSource).toContain('absolute -top-1 right-0 size-1.5 rounded-full');
    expect(indicatorSource).not.toContain('absolute top-0 right-0');

    for (const barSource of [source, notificationSource]) {
      expect(barSource).toContain('WorkspaceBarActionGlyph');
      expect(barSource).not.toContain('absolute top-0 right-0');
      expect(barSource).not.toContain('absolute top-1 right-0.5');
    }
    expect(notificationSource).not.toContain('bg-foreground px-1 text-center');
  });
});
