import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './lib/components/error-boundary';
import './lib/i18n';
import './index.css';
import 'devicon/devicon.min.css';
import type {
  AppSidePaneSnapshot,
  AppTabsSnapshot,
  NavigationSnapshot,
  SidebarSnapshot,
} from '@shared/view-state';
import { setupAppCommandProvider } from '@renderer/lib/commands/app-commands';
import { setupViewCommandProvider } from '@renderer/lib/commands/registry';
import { wireCommitHistoryInvalidation } from '@renderer/lib/commit-history-invalidation';
import { rpc } from '@renderer/lib/ipc';
import { wireModelRegistryInvalidation } from '@renderer/lib/monaco/invalidation-bridges';
import { codeEditorPool } from '@renderer/lib/monaco/monaco-code-pool';
import { diffEditorPool } from '@renderer/lib/monaco/monaco-diff-pool';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { wirePrCacheInvalidation } from '@renderer/lib/pr-cache-invalidation';
import type { AgentRuntimeSnapshot } from '@renderer/lib/stores/agent-runtime-store';
import { viewStateCache } from '@renderer/lib/stores/view-state-cache';
import { getTaskWindowLaunchTarget } from '@renderer/lib/task-window-launch-target';
import { log } from '@renderer/utils/logger';
import { initSoundPlayer } from '@renderer/utils/soundPlayer';
import { appState } from './lib/stores/app-state';

async function bootstrap() {
  // Wire invalidation bridges so FS and git events flow into the model registry.
  wireModelRegistryInvalidation(modelRegistry);
  wirePrCacheInvalidation();
  wireCommitHistoryInvalidation();

  appState.update.start();
  initSoundPlayer();

  // Warm Monaco in the background WITHOUT blocking first paint — `loader.init()`
  // costs ~1s and a window may not even show a code/diff tab. Editor consumers
  // (useMonacoLease, StickyDiffEditor) await the pool on demand, so deferring is
  // safe and lets the window paint ~1s sooner.
  const monacoInit = Promise.all([
    codeEditorPool.init(0).catch((error: unknown) => {
      log.warn('[monaco-code-pool] init failed:', error);
    }),
    diffEditorPool.init(0).catch((error: unknown) => {
      log.warn('[monaco-diff-pool] init failed:', error);
    }),
  ]);

  const [navResult, sidebarResult, allViewState] = await Promise.all([
    rpc.viewState.get('navigation') as Promise<NavigationSnapshot> | null,
    rpc.viewState.get('sidebar'),
    rpc.viewState.getAll(),
    appState.projects.load(),
    appState.workspaces.load(),
  ]);
  void monacoInit;

  viewStateCache.populate(allViewState as Record<string, unknown>);

  const agentRuntimeResult = (allViewState as Record<string, unknown>)?.agentRuntime;
  if (agentRuntimeResult) {
    appState.agentRuntime.restoreSnapshot(agentRuntimeResult as Partial<AgentRuntimeSnapshot>);
  }

  const launchTarget = getTaskWindowLaunchTarget();
  if (launchTarget) {
    appState.navigation.restoreSnapshot({
      currentViewId: 'task',
      viewParams: {
        ...(navResult?.viewParams ?? {}),
        task: {
          projectId: launchTarget.projectId,
          taskId: launchTarget.taskId,
        },
      },
    });
  } else if (navResult) {
    appState.navigation.restoreSnapshot(navResult);
  }
  // Detached task windows are single-route surfaces — no tab restoration there.
  if (!launchTarget) {
    const appTabsResult = (allViewState as Record<string, unknown>)?.appTabs;
    if (appTabsResult) {
      appState.appTabs.restoreSnapshot(appTabsResult as Partial<AppTabsSnapshot>);
    }
    const sidePaneResult = (allViewState as Record<string, unknown>)?.appSidePane;
    if (sidePaneResult) {
      appState.sidePane.restoreSnapshot(sidePaneResult as Partial<AppSidePaneSnapshot>);
    }
  }
  appState.appTabs.start();
  setupAppCommandProvider();
  setupViewCommandProvider();
  if (sidebarResult) {
    appState.sidebar.restoreSnapshot(sidebarResult as Partial<SidebarSnapshot>);
  } else {
    appState.sidebar.expandAllProjects();
  }

  // Avoid double-mount in dev which can duplicate PTY sessions
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

bootstrap().catch((error: unknown) => {
  log.error('Renderer bootstrap failed:', error);
});
