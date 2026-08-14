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
import { captureException } from '@renderer/_legacy/errorTracking';
import { wireSessionOpenPerformanceBridge } from '@renderer/features/tasks/session-open-performance-bridge';
import { isAiLabWindowLaunch } from '@renderer/lib/ai-lab-window-launch-target';
import { setupAppCommandProvider } from '@renderer/lib/commands/app-commands';
import { setupViewCommandProvider } from '@renderer/lib/commands/registry';
import { wireCommitHistoryInvalidation } from '@renderer/lib/commit-history-invalidation';
import { isComparisonWindowLaunch } from '@renderer/lib/comparison-window-launch-target';
import { rpc } from '@renderer/lib/ipc';
import { wireModelRegistryInvalidation } from '@renderer/lib/monaco/invalidation-bridges';
import { codeEditorPool } from '@renderer/lib/monaco/monaco-code-pool';
import { diffEditorPool } from '@renderer/lib/monaco/monaco-diff-pool';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { wirePrCacheInvalidation } from '@renderer/lib/pr-cache-invalidation';
import { loadTerminalSettings } from '@renderer/lib/pty/terminal-settings-cache';
import type { AgentRuntimeSnapshot } from '@renderer/lib/stores/agent-runtime-store';
import { viewStateCache } from '@renderer/lib/stores/view-state-cache';
import {
  getTaskWindowLaunchTarget,
  isTaskWindowLaunch,
} from '@renderer/lib/task-window-launch-target';
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
  // Prime the shared terminal settings snapshot during shell bootstrap. The
  // first task click must not be the event that starts a potentially multi-
  // second settings IPC; every later PtySession joins or reads this cache.
  void loadTerminalSettings().catch((error: unknown) => {
    log.warn('[terminal-settings] bootstrap preload failed', { error });
  });
  const isPrimaryAppWindow =
    !isTaskWindowLaunch && !isComparisonWindowLaunch && !isAiLabWindowLaunch;
  if (isPrimaryAppWindow) {
    // Keep main-process resume/spawn/first-output stages in the same DevTools
    // stream as renderer click/canonical-frame/paint timing.
    wireSessionOpenPerformanceBridge();
  }
  const launchTarget = getTaskWindowLaunchTarget();
  if (isPrimaryAppWindow) {
    // Subscribe happens during AppState construction. Hydrate the primary shell
    // immediately, but keep warm/detached windows from duplicating the scan.
    void appState.agentRuntime.hydrateActiveSessions();
  }

  // Warm Monaco in the background WITHOUT blocking first paint — `loader.init()`
  // costs ~1s and a window may not even show a code/diff tab. Editor consumers
  // (useMonacoLease, StickyDiffEditor) await the pool on demand, so deferring is
  // safe and lets the window paint ~1s sooner.
  const monacoInit = isPrimaryAppWindow
    ? Promise.all([
        codeEditorPool.init(0).catch((error: unknown) => {
          log.warn('[monaco-code-pool] init failed:', error);
        }),
        diffEditorPool.init(0).catch((error: unknown) => {
          log.warn('[monaco-diff-pool] init failed:', error);
        }),
      ])
    : Promise.resolve();

  const [navResult, sidebarResult, allViewState] = await Promise.all([
    isPrimaryAppWindow
      ? (rpc.viewState.get('navigation') as Promise<NavigationSnapshot> | null)
      : Promise.resolve(null),
    isPrimaryAppWindow ? rpc.viewState.get('sidebar') : Promise.resolve(null),
    isPrimaryAppWindow ? rpc.viewState.getAll() : Promise.resolve({}),
    isPrimaryAppWindow ? appState.projects.load() : Promise.resolve(),
    isPrimaryAppWindow ? appState.workspaces.load() : Promise.resolve(),
  ]);
  void monacoInit;

  if (isPrimaryAppWindow) {
    viewStateCache.populate(allViewState as Record<string, unknown>);

    const agentRuntimeResult = (allViewState as Record<string, unknown>)?.agentRuntime;
    if (agentRuntimeResult) {
      appState.agentRuntime.restoreSnapshot(agentRuntimeResult as Partial<AgentRuntimeSnapshot>);
    }
  }

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
  } else if (navResult && !isComparisonWindowLaunch && !isAiLabWindowLaunch) {
    appState.navigation.restoreSnapshot(navResult);
  }
  // Detached windows are not the app-tab surface — comparison windows tile their
  // own panes, while task and AI Lab windows are single-route, so skip restore.
  if (!launchTarget && !isComparisonWindowLaunch && !isAiLabWindowLaunch) {
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
  if (isPrimaryAppWindow) {
    if (sidebarResult) {
      appState.sidebar.restoreSnapshot(sidebarResult as Partial<SidebarSnapshot>);
    } else {
      appState.sidebar.expandAllProjects();
    }
    appState.projects.mountInitialProjects().catch(() => {});
  }
  if (isPrimaryAppWindow) {
    for (const project of appState.projects.projects.values()) {
      const projectData = project.data;
      if (projectData?.type === 'ssh') {
        void appState.agentRuntime.hydrateProject(projectData.id);
      }
    }
  }

  // Avoid double-mount in dev which can duplicate PTY sessions
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

bootstrap().catch((error: unknown) => {
  captureException(error, {
    component: 'bootstrap',
    error_type: 'bootstrap_error',
    severity: 'critical',
  });
  log.error('Renderer bootstrap failed:', error);
});
