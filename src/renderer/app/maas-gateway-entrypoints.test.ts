import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('MaaS Gateway entry-point wiring', () => {
  it('routes the bottom-bar Gateway requirement to Library Extensions', () => {
    const source = readFileSync(new URL('./workspace-runtime-bar.tsx', import.meta.url), 'utf8');

    expect(source).toContain('<MaasGlobalSelector');
    expect(source).toMatch(
      /onOpenMarketplace=\{\(\) =>\s+appState\.navigation\.navigate\('library', \{ section: 'extensions' \}\)\s+\}/
    );
  });

  it('dismisses the bottom-bar model access popover when the app window loses focus', () => {
    const source = readFileSync(new URL('./workspace-runtime-bar.tsx', import.meta.url), 'utf8');

    expect(source).toContain('useDismissOnWindowBlur(isMaasPopoverOpen, dismissMaasPopover)');
    expect(source).toContain(
      '<Popover open={isMaasPopoverOpen} onOpenChange={setIsMaasPopoverOpen}>'
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
