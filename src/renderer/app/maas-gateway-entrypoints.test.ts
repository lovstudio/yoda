import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('MaaS Gateway entry-point wiring', () => {
  it('keeps MaaS as one global surface outside the Agent account popover', () => {
    const source = readFileSync(new URL('./workspace-runtime-bar.tsx', import.meta.url), 'utf8');
    const officialAccountStart = source.indexOf(
      '{maasActiveForRuntime || shortAccountWindow || officialCodexAccountAvailable'
    );
    const accountEnd = source.indexOf('<span className="flex-1" />', officialAccountStart);
    const maasPopoverStart = source.indexOf('<WorkspaceMaasPopover', accountEnd);

    expect(officialAccountStart).toBeGreaterThanOrEqual(0);
    expect(accountEnd).toBeGreaterThan(officialAccountStart);
    expect(maasPopoverStart).toBeGreaterThan(accountEnd);
    expect(source.match(/<WorkspaceMaasPopover/g)).toHaveLength(1);
    expect(source).not.toContain('maasAccount');
    expect(source).not.toContain('getWorkspaceMaasAccountPresentation');
    expect(source).not.toContain('openMaasMarketplace');
  });

  it('dismisses the global model access popover when the app window loses focus', () => {
    const source = readFileSync(new URL('./workspace-runtime-bar.tsx', import.meta.url), 'utf8');

    expect(source).toMatch(/usePopoverDismiss\(\s*isMaasPopoverOpen,\s+setIsMaasPopoverOpen\s*\)/);
    expect(source).toMatch(
      /<Popover\s+open=\{isMaasPopoverOpen\}\s+onOpenChange=\{setIsMaasPopoverOpen\}\s+actionsRef=\{maasActionsRef\}/
    );
    expect(source).toContain('{isMaasPopoverOpen ? (');
    expect(source).toContain('aria-label={maasTriggerLabel}');
  });

  it('dismisses the global model access popover before opening details or logs', () => {
    const source = readFileSync(new URL('./workspace-runtime-bar.tsx', import.meta.url), 'utf8');

    expect(source).toContain('onManage={openMaasManagement}');
    expect(source).toContain('onOpenLogs={openMaasLogs}');
    expect(source).toMatch(
      /const openMaasManagement = useCallback\(\(\) => \{\s+dismissMaasPopoverThen\(\(\) => \{\s+appState\.sidePane\.pinView\('settings', \{\s+tab: 'maas',/
    );
    expect(source).toMatch(
      /const openMaasLogs = useCallback\(\(\) => \{\s+dismissMaasPopoverThen\(\(\) => \{\s+appState\.sidePane\.pinView\('settings', \{ tab: 'ai-logs' \}\);/
    );
  });

  it('keeps model access on the Settings pane instead of a standalone route', () => {
    const source = readFileSync(
      new URL('../features/settings/components/SettingsPage.tsx', import.meta.url),
      'utf8'
    );

    expect(source).toMatch(
      /<MaasView\s+key=\{focusMaasPlatformId \?\? ''\}\s+embedded\s+requestedPlatformId=\{focusMaasPlatformId\}\s+onOpenMarketplace=\{\(\) =>\s+navigate\('library', \{ section: 'extensions' \}\)\s*\}/
    );
    expect(readFileSync(new URL('./view-registry.ts', import.meta.url), 'utf8')).not.toContain(
      'maas: maasView'
    );
  });
});
