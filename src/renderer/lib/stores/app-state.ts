import { ProjectManagerStore } from '@renderer/features/projects/stores/project-manager';
import { SidebarStore } from '@renderer/features/sidebar/sidebar-store';
import { WorkspaceStore } from '@renderer/features/workspaces/workspace-store';
import { AgentRuntimeStore } from './agent-runtime-store';
import { AppSidePaneStore } from './app-side-pane-store';
import {
  APP_STATE_HMR_SCHEMA_VERSION,
  isReusableAppState,
  needsFullReloadForRetainedAppState,
} from './app-state-hmr';
import { AppTabsStore } from './app-tabs-store';
import { DependenciesStore } from './dependencies-store';
import { NavigationHistoryStore } from './navigation-history-store';
import { NavigationStore } from './navigation-store';
import { snapshotRegistry, type SnapshotRegistry } from './snapshot-registry';
import { SshConnectionStore } from './ssh-connection-store';
import { UpdateStore } from './update-store';

class AppState {
  readonly hmrSchemaVersion = APP_STATE_HMR_SCHEMA_VERSION;
  readonly update: UpdateStore;
  readonly projects: ProjectManagerStore;
  readonly workspaces: WorkspaceStore;
  readonly sidebar: SidebarStore;
  readonly snapshots: SnapshotRegistry;
  readonly history: NavigationHistoryStore;
  readonly navigation: NavigationStore;
  readonly appTabs: AppTabsStore;
  readonly sidePane: AppSidePaneStore;
  readonly dependencies: DependenciesStore;
  readonly sshConnections: SshConnectionStore;
  readonly agentRuntime: AgentRuntimeStore;

  constructor() {
    this.snapshots = snapshotRegistry;
    this.update = new UpdateStore();
    this.projects = new ProjectManagerStore();
    this.workspaces = new WorkspaceStore();
    this.agentRuntime = new AgentRuntimeStore();
    this.sidebar = new SidebarStore(this.projects, this.workspaces, this.agentRuntime);
    this.history = new NavigationHistoryStore();
    this.navigation = new NavigationStore();
    this.appTabs = new AppTabsStore(this.navigation);
    this.sidePane = new AppSidePaneStore();
    this.dependencies = new DependenciesStore();
    this.sshConnections = new SshConnectionStore({
      onConnectionReady: (connectionId) => void this.dependencies.refreshAgents(connectionId),
    });
    snapshotRegistry.register('navigation', () => this.navigation.snapshot);
    snapshotRegistry.register('appTabs', () => this.appTabs.snapshot);
    snapshotRegistry.register('appSidePane', () => this.sidePane.snapshot);
    snapshotRegistry.register('sidebar', () => this.sidebar.snapshot);
    snapshotRegistry.register('agentRuntime', () => this.agentRuntime.snapshot);
    this.dependencies.start();
    this.sshConnections.start();
    void this.agentRuntime.start();
  }
}

type AppStateHotData = {
  appState?: AppState;
};

const hotData = import.meta.hot?.data as AppStateHotData | undefined;
const retainedAppState = hotData?.appState;
const canReuseRetainedAppState = isReusableAppState(retainedAppState);
const needsFullReload = needsFullReloadForRetainedAppState(
  retainedAppState,
  import.meta.hot !== undefined
);

// A fresh AppState must go through main.tsx bootstrap before it is usable. Keep
// the old instance alive for this final HMR turn, then reload the renderer so
// the new class fields/methods are constructed and persisted snapshots hydrate.
if (needsFullReload) {
  queueMicrotask(() => window.location.reload());
}

export const appState = canReuseRetainedAppState
  ? retainedAppState!
  : (retainedAppState ?? new AppState());

if (import.meta.hot) {
  import.meta.hot.dispose((data: AppStateHotData) => {
    data.appState = appState;
  });
}

// Re-export for callers that previously imported sidebarStore from sidebar-store.ts.
export const sidebarStore = appState.sidebar;
export const workspaceStore = appState.workspaces;
export const agentRuntimeStore = appState.agentRuntime;
