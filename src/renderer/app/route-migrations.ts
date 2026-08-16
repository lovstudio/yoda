export type PersistedViewRoute = {
  viewId: string;
  params: Record<string, unknown>;
};

/** Keep restored tabs, navigation, and side-pane pins on the Library surface
 * after Marketplace's sections move back under its secondary navigation. */
export function migratePersistedViewRoute(route: PersistedViewRoute): PersistedViewRoute {
  // Model access is a Settings pane, not a surface of its own — the standalone
  // route rendered the same view minus the global-binding control, which left
  // two designs for one thing.
  if (route.viewId === 'maas') {
    return {
      viewId: 'settings',
      params: { tab: 'maas', maasPlatformId: route.params.platformId },
    };
  }

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

  // A multi-agent roster is edited inside its own paradigm now, so the Library
  // no longer keeps a section for teams. Anyone parked there lands on the agents
  // that a roster is built from.
  if (route.params.section === 'agentTeams') {
    return {
      viewId: 'library',
      params: { section: 'agents' },
    };
  }

  return route;
}
