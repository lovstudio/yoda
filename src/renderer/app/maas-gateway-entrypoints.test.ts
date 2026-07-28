import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('MaaS Gateway entry-point wiring', () => {
  it('routes the bottom-bar Gateway requirement to Marketplace', () => {
    const source = readFileSync(new URL('./workspace-runtime-bar.tsx', import.meta.url), 'utf8');

    expect(source).toContain('<MaasGlobalSelector');
    expect(source).toContain(
      "onOpenMarketplace={() => appState.navigation.navigate('marketplace')}"
    );
  });

  it('routes the Settings MaaS requirement to Marketplace', () => {
    const source = readFileSync(
      new URL('../features/settings/components/SettingsPage.tsx', import.meta.url),
      'utf8'
    );

    expect(source).toMatch(
      /<MaasView\s+embedded\s+onOpenMarketplace=\{\(\) => navigate\('marketplace'\)\}/
    );
  });
});
