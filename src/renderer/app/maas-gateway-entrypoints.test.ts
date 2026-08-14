import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('MaaS Gateway entry-point wiring', () => {
  it('keeps one MaaS selector inside the active account popover', () => {
    const source = readFileSync(new URL('./workspace-runtime-bar.tsx', import.meta.url), 'utf8');
    const accountStart = source.indexOf('{maasAccount ? (');
    const selectorStart = source.indexOf('<MaasGlobalSelector');
    const officialAccountStart = source.indexOf(
      'shortAccountWindow || officialCodexAccountAvailable'
    );

    expect(accountStart).toBeGreaterThanOrEqual(0);
    expect(selectorStart).toBeGreaterThan(accountStart);
    expect(selectorStart).toBeLessThan(officialAccountStart);
    expect(source.match(/<MaasGlobalSelector/g)).toHaveLength(1);
    expect(source).toContain('onOpenMarketplace={openMaasMarketplace}');
    expect(source).toMatch(
      /const openMaasMarketplace = useCallback\(\(\) => \{\s+dismissBeforeSynchronousAction\(dismissMaasPopover, \(\) => \{\s+appState\.navigation\.navigate\('library', \{ section: 'extensions' \}\);/
    );
  });

  it('dismisses the account model access popover when the app window loses focus', () => {
    const source = readFileSync(new URL('./workspace-runtime-bar.tsx', import.meta.url), 'utf8');

    expect(source).toContain('useDismissOnWindowBlur(isMaasPopoverOpen, dismissMaasPopover)');
    expect(source).toContain(
      '<Popover open={isMaasPopoverOpen} onOpenChange={setIsMaasPopoverOpen}>'
    );
    expect(source).toContain('{isMaasPopoverOpen ? (');
    expect(source).not.toContain('aria-label={maasTriggerLabel}');
  });

  it('dismisses the account model access popover before opening details or logs', () => {
    const source = readFileSync(new URL('./workspace-runtime-bar.tsx', import.meta.url), 'utf8');

    expect(source).toContain('onManagePlatform={openMaasManagement}');
    expect(source).toContain('onClick={openMaasManagement}');
    expect(source).toContain('onClick={openMaasLogs}');
    expect(source).toMatch(
      /const openMaasManagement = useCallback\(\(\) => \{\s+dismissBeforeSynchronousAction\(dismissMaasPopover, \(\) => \{\s+appState\.navigation\.navigate\('maas'\);/
    );
    expect(source).toMatch(
      /const openMaasLogs = useCallback\(\(\) => \{\s+dismissBeforeSynchronousAction\(dismissMaasPopover, \(\) => \{\s+appState\.sidePane\.pinView\('settings', \{ tab: 'ai-logs' \}\);/
    );
  });

  it('routes the Settings MaaS requirement to Library Extensions', () => {
    const source = readFileSync(
      new URL('../features/settings/components/SettingsPage.tsx', import.meta.url),
      'utf8'
    );

    expect(source).toMatch(
      /<MaasView\s+embedded\s+onOpenMarketplace=\{\(\) =>\s+navigate\('library', \{ section: 'extensions' \}\)\s*\}/
    );
  });
});
