import { describe, expect, it } from 'vitest';
import { migratePersistedViewRoute } from './route-migrations';

describe('persisted view route migrations', () => {
  it('moves Apps from Library to Marketplace without losing the selected app', () => {
    expect(
      migratePersistedViewRoute({
        viewId: 'library',
        params: { section: 'apps', appId: 'app-1' },
      })
    ).toEqual({
      viewId: 'marketplace',
      params: { section: 'apps', appId: 'app-1' },
    });
  });

  it('moves the former Library extension catalog to Marketplace extensions', () => {
    expect(
      migratePersistedViewRoute({
        viewId: 'library',
        params: { section: 'marketplace', appId: 'stale-app' },
      })
    ).toEqual({
      viewId: 'marketplace',
      params: { section: 'extensions' },
    });
  });

  it('leaves current routes unchanged', () => {
    const route = {
      viewId: 'library',
      params: { section: 'prompts' },
    };

    expect(migratePersistedViewRoute(route)).toBe(route);
  });
});
