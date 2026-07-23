import { describe, expect, it } from 'vitest';
import { AppSidePaneStore } from './app-side-pane-store';

describe('AppSidePaneStore view pins', () => {
  it('toggles the matching view pin by route identity', () => {
    const store = new AppSidePaneStore();
    const params = { section: 'apps', appId: 'app-1' };

    store.toggleView('library', params);

    const pin = store.findViewPin('library', { appId: 'app-1', section: 'apps' });
    expect(pin).toBeDefined();
    expect(store.activePinId).toBe(pin?.id);

    store.toggleView('library', { appId: 'app-1', section: 'apps' });

    expect(store.findViewPin('library', params)).toBeUndefined();
    expect(store.pins).toHaveLength(0);
    expect(store.activePinId).toBeNull();
  });

  it('only unpins the matching route', () => {
    const store = new AppSidePaneStore();
    store.pinView('library', { section: 'apps', appId: 'app-1' });
    store.pinView('settings', {});

    store.toggleView('library', { section: 'apps', appId: 'app-1' });

    expect(store.findViewPin('library', { section: 'apps', appId: 'app-1' })).toBeUndefined();
    expect(store.findViewPin('settings', {})).toBeDefined();
    expect(store.pins).toHaveLength(1);
  });
});
