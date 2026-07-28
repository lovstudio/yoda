export type PersistedViewRoute = {
  viewId: string;
  params: Record<string, unknown>;
};

/**
 * Apps and the extension catalog used to live inside Library. Keep restored
 * tabs, navigation, and side-pane pins attached to the same product surface
 * after both sections move under Marketplace.
 */
export function migratePersistedViewRoute(route: PersistedViewRoute): PersistedViewRoute {
  if (route.viewId !== 'library') return route;

  if (route.params.section === 'apps' || route.params.section === 'aiLab') {
    return {
      viewId: 'marketplace',
      params: { ...route.params, section: 'apps' },
    };
  }

  if (route.params.section === 'marketplace') {
    return {
      viewId: 'marketplace',
      params: { section: 'extensions' },
    };
  }

  return route;
}
