import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Workspace runtime bar responsive layout', () => {
  const source = readFileSync(new URL('./workspace-runtime-bar.tsx', import.meta.url), 'utf8');
  const skillPopoverSource = readFileSync(
    new URL('./workspace-skill-popover.tsx', import.meta.url),
    'utf8'
  );

  it('uses its own container width and never wraps the single-line status bar', () => {
    expect(source).toContain('@container flex h-8 min-w-0');
    expect(source).toContain('overflow-hidden whitespace-nowrap');
  });

  it('compacts action labels together while preserving accessible triggers', () => {
    expect(source).toContain(
      "const RUNTIME_BAR_ACTION_LABEL_CLASS = 'hidden @min-[1441px]:inline';"
    );
    expect(source).toContain('className="tabular-nums @max-[1440px]:hidden"');
    expect(source).toContain('WORKSPACE_BAR_ACTION_COUNT_CLASS');
    expect(source).toContain('@max-[1440px]:hidden');
    expect(source.match(/className=\{RUNTIME_BAR_ACTION_LABEL_CLASS\}/g)).toHaveLength(5);
    expect(source).toContain('triggerLabelClassName={RUNTIME_BAR_ACTION_LABEL_CLASS}');
    expect(skillPopoverSource).toContain('className={triggerLabelClassName}');
  });

  it('keeps global configuration as the first footer action and aligns its popover left', () => {
    const footerStart = source.indexOf('<footer');
    const configRender = source.indexOf('{renderConfigPopover()}', footerStart);
    const runtimeGroup = source.indexOf('{runtimeId ? (', footerStart);
    const configStart = source.indexOf(
      '<Popover open={isConfigPopoverOpen} onOpenChange={setIsConfigPopoverOpen}>'
    );
    const groupSpacer = source.indexOf('<span className="flex-1" />');
    const configEnd = source.indexOf('</Popover>', configStart);

    expect(configRender).toBeGreaterThan(footerStart);
    expect(configRender).toBeLessThan(runtimeGroup);
    expect(source.match(/\{renderConfigPopover\(\)\}/g)).toHaveLength(1);
    expect(configStart).toBeGreaterThan(-1);
    expect(configStart).toBeLessThan(groupSpacer);
    expect(source.slice(configStart, configEnd)).toContain('align="start"');
  });

  it('progressively removes secondary session copy before compact status visuals', () => {
    expect(source).toContain('@max-[1120px]:hidden');
    expect(source).toContain('max-w-40 truncate @max-[1440px]:hidden');
    expect(source).toContain('truncate font-medium text-foreground @max-[720px]:hidden');
    expect(source).toContain("compact ? 'h-1 w-9 @max-[720px]:hidden'");
  });

  it('keeps session-history visibility in the context popover as a labelled row, not a bare toggle', () => {
    expect(source).not.toContain('<MessageSquare');
    expect(source).not.toContain('resolveSessionPrompts');
    const contextPopover = contextPopoverSource();

    expect(contextPopover).toContain("t('workspaceRuntime.sessionHistoryVisibility')");
    expect(contextPopover).toContain('onCheckedChange={toggleSessionHistoryDock}');
    // A setting needs a visible name and rationale; a tooltip on a naked
    // switch reads as decoration.
    expect(contextPopover).toContain("t('workspaceRuntime.sessionHistoryVisibilityDescription')");
  });

  it('keeps secondary context actions behind a compact overflow menu', () => {
    const contextPopover = contextPopoverSource();

    expect(contextPopover).toContain('<WorkspaceBarCardMenu>');
    expect(contextPopover).toContain('presentation="menu-item"');
    expect(contextPopover).toContain('<Minimize2');
    expect(contextPopover).not.toContain("t('workspaceRuntime.replyScreenshotDescription')");
  });

  function contextPopoverSource(): string {
    const start = source.indexOf("t('workspaceRuntime.contextPopoverTitle')");
    return source.slice(start, source.indexOf('</PopoverContent>', start));
  }
});
