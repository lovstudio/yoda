import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setupAppCommandProvider } from './app-commands';
import { commandRegistry } from './registry';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openNewTaskFromPreference: vi.fn(),
  showModal: vi.fn(),
}));

vi.mock('@renderer/app/open-new-task', () => ({
  openNewTaskFromPreference: mocks.openNewTaskFromPreference,
}));

vi.mock('@renderer/app/view-registry', () => ({
  views: {},
}));

vi.mock('@renderer/lib/components/nav-buttons', () => ({
  applyHistoryEntry: vi.fn(),
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  showModal: mocks.showModal,
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    navigation: {
      currentViewId: 'home',
      viewParamsStore: {},
      navigate: mocks.navigate,
    },
    history: {
      canGoBack: false,
      canGoForward: false,
      back: vi.fn(),
      forward: vi.fn(),
    },
  },
}));

describe('app new-task command', () => {
  beforeAll(() => {
    setupAppCommandProvider();
  });

  it('routes the global shortcut through the shared new-task preference', () => {
    const command = commandRegistry.activeCommands.find((item) => item.id === 'app.newTask');

    expect(command).toBeDefined();
    command?.execute();

    expect(mocks.openNewTaskFromPreference).toHaveBeenCalledWith(undefined);
    expect(mocks.showModal).not.toHaveBeenCalledWith('taskModal', expect.anything());
  });
});
