import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('MaaS Gateway entry-point wiring', () => {
  it('routes the bottom-bar Gateway requirement to Library Extensions', () => {
    const source = readFileSync(new URL('./workspace-runtime-bar.tsx', import.meta.url), 'utf8');

    expect(source).toContain('<MaasGlobalSelector');
    expect(source).toContain('onOpenMarketplace={openMaasMarketplace}');
    expect(source).toMatch(
      /const openMaasMarketplace = useCallback\(\(\) => \{\s+dismissMaasPopover\(\);\s+appState\.navigation\.navigate\('library', \{ section: 'extensions' \}\);/
    );
  });

  it('dismisses the bottom-bar model access popover when the app window loses focus', () => {
    const source = readFileSync(new URL('./workspace-runtime-bar.tsx', import.meta.url), 'utf8');

    expect(source).toContain('useDismissOnWindowBlur(isMaasPopoverOpen, dismissMaasPopover)');
    expect(source).toContain(
      '<Popover open={isMaasPopoverOpen} onOpenChange={setIsMaasPopoverOpen}>'
    );
  });

  it('dismisses the bottom-bar model access popover before opening details or logs', () => {
    const source = readFileSync(new URL('./workspace-runtime-bar.tsx', import.meta.url), 'utf8');

    expect(source).toContain('onManagePlatform={openMaasManagement}');
    expect(source).toContain('onClick={openMaasManagement}');
    expect(source).toContain('onClick={openMaasLogs}');
    expect(source).toMatch(
      /const openMaasManagement = useCallback\(\(\) => \{\s+dismissMaasPopover\(\);\s+appState\.navigation\.navigate\('maas'\);/
    );
    expect(source).toMatch(
      /const openMaasLogs = useCallback\(\(\) => \{\s+dismissMaasPopover\(\);\s+appState\.sidePane\.pinView\('settings', \{ tab: 'ai-logs' \}\);/
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
