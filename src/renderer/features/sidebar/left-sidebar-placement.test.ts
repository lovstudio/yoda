import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('LeftSidebar app placement', () => {
  it('renders pinned Apps beneath Marketplace instead of Library', () => {
    const source = readFileSync(new URL('./left-sidebar.tsx', import.meta.url), 'utf8');
    const libraryIndex = source.indexOf(
      '<GlobalSidePaneTarget viewId="library" params={libraryParams}'
    );
    const marketplaceIndex = source.indexOf(
      '<GlobalSidePaneTarget viewId="marketplace" params={marketplaceParams}'
    );
    const pinnedAppsIndex = source.indexOf('{pinnedApps.map((app) => (');

    expect(libraryIndex).toBeGreaterThan(-1);
    expect(marketplaceIndex).toBeGreaterThan(libraryIndex);
    expect(pinnedAppsIndex).toBeGreaterThan(marketplaceIndex);
    expect(source.slice(pinnedAppsIndex)).toContain('viewId="marketplace"');
  });
});
