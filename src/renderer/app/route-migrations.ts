export type PersistedViewRoute = {
  viewId: string;
  params: Record<string, unknown>;
};

/** Keep restored tabs, navigation, and side-pane pins on the Library surface
 * after Marketplace's sections move back under its secondary navigation. */
export function migratePersistedViewRoute(route: PersistedViewRoute): PersistedViewRoute {
  if (route.viewId === 'marketplace') {
    return {
      viewId: 'library',
      params: {
        ...route.params,
        section: route.params.section === 'apps' ? 'apps' : 'extensions',
      },
    };
  }

  if (route.viewId !== 'library') return route;

  if (route.params.section === 'aiLab') {
    return {
      viewId: 'library',
      params: { ...route.params, section: 'apps' },
    };
  }

  if (route.params.section === 'marketplace') {
    return {
      viewId: 'library',
      params: { section: 'extensions' },
    };
  }

  return route;
}
