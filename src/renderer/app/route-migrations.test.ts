import { describe, expect, it } from 'vitest';
import { migratePersistedViewRoute } from './route-migrations';

describe('persisted view route migrations', () => {
  it('moves Marketplace Apps back into Library without losing the selected app', () => {
    expect(
      migratePersistedViewRoute({
        viewId: 'marketplace',
        params: { section: 'apps', appId: 'app-1' },
      })
    ).toEqual({
      viewId: 'library',
      params: { section: 'apps', appId: 'app-1' },
    });
  });

  it('moves Marketplace Extensions back into the Library Extensions section', () => {
    expect(
      migratePersistedViewRoute({
        viewId: 'marketplace',
        params: { section: 'extensions' },
      })
    ).toEqual({
      viewId: 'library',
      params: { section: 'extensions' },
    });
  });

  it('keeps legacy Library section aliases on the Library surface', () => {
    expect(
      migratePersistedViewRoute({
        viewId: 'library',
        params: { section: 'aiLab', appId: 'app-1' },
      })
    ).toEqual({
      viewId: 'library',
      params: { section: 'apps', appId: 'app-1' },
    });

    expect(
      migratePersistedViewRoute({
        viewId: 'library',
        params: { section: 'marketplace', appId: 'stale-app' },
      })
    ).toEqual({
      viewId: 'library',
      params: { section: 'extensions' },
    });

    expect(
      migratePersistedViewRoute({
        viewId: 'library',
        params: { section: 'agentTeams' },
      })
    ).toEqual({
      viewId: 'library',
      params: { section: 'agents' },
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
