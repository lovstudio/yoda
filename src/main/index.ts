import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import dockIcon from '@/assets/images/yoda/icon-dock.png?asset';
import { PRODUCT_NAME } from '@shared/app-identity';
import { registerRPCRouter } from '@shared/ipc/rpc';
import { deepLinkService } from './app/deep-link';
import { externalFileOpenService } from './app/external-file-open';
import { setupApplicationMenu } from './app/menu';
import { registerAppScheme, setupAppProtocol } from './app/protocol';
import { createMainWindow, focusExistingFullAppWindow, markAppQuitting } from './app/window';
import { registerWindowIpc } from './app/window-ipc';
import { yodaAccountService } from './core/account/services/yoda-account-service';
import { agentHookService } from './core/agent-hooks/agent-hook-service';
import { aiLabService } from './core/ai-lab/ai-lab-service';
import {
  combineActiveSessionSummaries,
  resolveAgentSessionSummaryForShutdown,
  resolveQuitAgentSessionsDecision,
} from './core/app/quit-agent-sessions';
import { appService } from './core/app/service';
import { automationScheduler } from './core/automation/automation-scheduler';
import { agentSessionRuntimeStore } from './core/conversations/agent-session-runtime';
import { persistConversationRunOutcome } from './core/conversations/conversation-run-outcome';
import { runStateReconcilerService } from './core/conversations/run-state-reconciler';
import { sessionSummaryAutoRefreshService } from './core/conversations/session-summary-autorefresh';
import { localDependencyManager } from './core/dependencies/dependency-manager';
import { knownBinDirs } from './core/dependencies/probe';
import { editorBufferService } from './core/editor/editor-buffer-service';
import { extensionMarketplaceService } from './core/extensions/extension-marketplace-service';
import { gitWatcherRegistry } from './core/git/git-watcher-registry';
import { issueWorkerService } from './core/issues/issue-worker-service';
import { cliProxyApiManagedService } from './core/maas/cliproxyapi-managed-service';
import { maasService } from './core/maas/maas-service';
import { mobileGatewayService } from './core/mobile-gateway/mobile-gateway-service';
import { mobileRelayService } from './core/mobile-gateway/mobile-relay-service';
import { initializeMobileSyncMode } from './core/mobile-gateway/mobile-sync-mode';
import { ensureInternalProject } from './core/projects/operations/ensureInternalProject';
import { projectManager } from './core/projects/project-manager';
import { promptLibraryService } from './core/prompt-library/prompt-library-service';
import { promptSourceService } from './core/prompt-library/prompt-source-service';
import { ptySessionRegistry } from './core/pty/pty-session-registry';
import { prSyncScheduler } from './core/pull-requests/pr-sync-scheduler';
import { searchService } from './core/search/search-service';
import { modelProviderCatalogService } from './core/settings/model-provider-catalog-service';
import { runtimeModelCandidatesService } from './core/settings/runtime-model-candidates-service';
import { appSettingsService } from './core/settings/settings-service';
import { archivedTaskReactivationService } from './core/tasks/archived-task-reactivation';
import { resumePendingTaskArchives } from './core/tasks/operations/archiveTask';
import { taskManager } from './core/tasks/task-manager';
import { roomConductor } from './core/team-rooms/conductor';
import { githubRoomMonitor } from './core/team-rooms/github-room-monitor';
import { workspaceTerminalService } from './core/terminals/workspace-terminal-service';
import { updateService } from './core/updates/update-service';
import { viewStateService } from './core/view-state/view-state-service';
import type { TeardownMode } from './core/workspaces/workspace-registry';
import { initializeDatabase } from './db/initialize';
import { setLogDirectory } from './lib/log-file';
import { log } from './lib/logger';
import { telemetryService } from './lib/telemetry';
import { rpcRouter } from './rpc';
import { ensureUserBinDirsInPath, resolveUserEnv } from './utils/userEnv';

if (import.meta.env.DEV) {
  dotenvConfig({ path: '.env.local', override: false });
}

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
}

// Block audible autoplay everywhere (incl. embedded <webview>): media stays
// silent until a real user gesture, so a background page can't blast sound out
// of nowhere. Muted autoplay is still allowed, so visuals are unaffected.
app.commandLine.appendSwitch('autoplay-policy', 'document-user-activation-required');

registerAppScheme();
deepLinkService.register();
externalFileOpenService.register();

app.setName(PRODUCT_NAME);

const yodaUserData = join(app.getPath('appData'), 'yoda');
app.setPath('userData', yodaUserData);

// From here on `log.warn`/`log.error` (main and renderer alike) also land on
// disk, so a stuck session leaves evidence instead of vanishing with devtools.
setLogDirectory(app.getPath('logs'));

function createMainWindowWithDeepLinkReset(): BrowserWindow {
  deepLinkService.markRendererNotReady();
  externalFileOpenService.markRendererNotReady();
  const win = createMainWindow();
  win.webContents.on('did-start-loading', () => {
    deepLinkService.markRendererNotReady();
    externalFileOpenService.markRendererNotReady();
  });
  return win;
}

app.on('second-instance', (_event, argv) => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win?.isMinimized()) win.restore();
  win?.focus();
  deepLinkService.enqueueArgv(argv);
  externalFileOpenService.enqueueArgv(argv);
});

if (!import.meta.env.DEV && !app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

if (import.meta.env.DEV) {
  try {
    app.dock?.setIcon(dockIcon);
  } catch (err) {
    log.warn('Failed to set dock icon:', err);
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // Surface an existing full-app window if one is alive; the hidden pre-warmed
  // task window must not count, or closing the main window would leave the dock
  // click inert (getAllWindows() never reaches 0 while a warm window parks).
  if (!focusExistingFullAppWindow()) {
    createMainWindowWithDeepLinkReset();
  }
});

void app.whenReady().then(async () => {
  const __bootT0 = Date.now();
  const __bootMark = (label: string) =>
    console.log(`[DEBUG][boot] ${label} +${Date.now() - __bootT0}ms`);
  __bootMark('whenReady fired');
  console.log('[BUILD-MARKER] agent-run-state-sync v4 (stateless-derive + claude-awaiting)');
  agentSessionRuntimeStore.initialize({
    recordRunOutcome: (conversationId, status) =>
      void persistConversationRunOutcome(conversationId, status),
  });

  // Synchronously seed the common user bin dirs (Homebrew, /usr/local/bin, nvm,
  // cargo, …) into PATH before anything can spawn. A GUI-launched (launchd /
  // Finder) Electron process inherits a stunted PATH, and the full login-shell
  // capture below is async — so during the boot window any bare-name CLI lookup
  // (`tmux -V`, the tmux session spawn, git, …) would miss Homebrew and report
  // "not found", even though the dependency probe (which disk-scans these same
  // dirs) reports it available. Seeding here closes that race for every spawn.
  const seededBinDirs = ensureUserBinDirsInPath(knownBinDirs());
  if (seededBinDirs.length > 0) {
    __bootMark(`seeded PATH bin dirs (${seededBinDirs.length})`);
  }

  // Login-shell env capture (`$SHELL -ilc 'env'`) can take 1-2s when the user
  // has a heavy zsh init (mise/oh-my-zsh/starship). Downstream consumers (PTY,
  // dependency probe, SSH) already fall back to `process.env` / `launchctl`
  // when SSH_AUTH_SOCK isn't set yet, and they only run after the user
  // interacts with a project — so don't block the window on this.
  const userEnvReady = resolveUserEnv()
    .then(() => __bootMark('resolveUserEnv done (background)'))
    .catch((e) => {
      log.warn('Failed to resolve user env:', e);
    });
  __bootMark('resolveUserEnv kicked off (non-blocking)');

  try {
    await initializeDatabase();
    __bootMark('initializeDatabase done');
    await aiLabService.initialize().catch((error: unknown) => {
      log.warn('Failed to restore pending Yoda Build tasks:', error);
    });
    sessionSummaryAutoRefreshService.initialize();
    runStateReconcilerService.initialize();
    archivedTaskReactivationService.initialize();
    searchService.initialize();
    __bootMark('searchService.initialize done');
    void editorBufferService.pruneStale();
    try {
      viewStateService.pruneOrphans();
    } catch (e: unknown) {
      log.warn('view-state: failed to prune orphaned entries', { error: e });
    }
    __bootMark('view-state pruneOrphans done');
  } catch (error) {
    log.error('Failed to initialize database:', error);
    dialog.showErrorBox(
      'Database Initialization Failed',
      `${PRODUCT_NAME} could not start because the database failed to initialize.\n\n${error instanceof Error ? error.message : String(error)}`
    );
    app.quit();
    return;
  }

  // App settings must be ready before the renderer queries them on first paint.
  await appSettingsService.initialize();
  await promptLibraryService.initialize();
  await promptSourceService.initialize();
  ptySessionRegistry.setScrollbackLines((await appSettingsService.get('terminal')).scrollbackLines);
  __bootMark('appSettingsService.initialize done');
  await extensionMarketplaceService.initialize().catch((error: unknown) => {
    log.warn('Failed to initialize the Yoda Extension Marketplace:', error);
  });
  __bootMark('extensionMarketplaceService.initialize done');
  await maasService.reconcileActiveBindings().catch((error: unknown) => {
    log.warn('Failed to reconcile the active MaaS provider configuration:', error);
  });
  __bootMark('maasService.reconcileActiveBindings done');

  // Bootstrap the internal "Drafts" project (hosts no-project agent sessions).
  // Must run before RPC so the renderer's first project list query sees it.
  await ensureInternalProject().catch((e) => {
    log.warn('ensureInternalProject failed:', e);
  });
  __bootMark('ensureInternalProject done');

  // RPC router must be registered before the renderer fires its first IPC call.
  registerRPCRouter(rpcRouter, ipcMain);
  registerWindowIpc(ipcMain);
  __bootMark('registerRPCRouter done');
  deepLinkService.start();
  externalFileOpenService.start();

  setupAppProtocol(join(app.getAppPath(), 'out', 'renderer'));
  await setupApplicationMenu(requestRestart);
  __bootMark('protocol + menu done');
  const __win = createMainWindowWithDeepLinkReset();
  __bootMark('createMainWindow returned');
  __win.webContents.once('did-start-loading', () => __bootMark('webContents did-start-loading'));
  __win.webContents.once('dom-ready', () => __bootMark('webContents dom-ready'));
  __win.webContents.once('did-finish-load', () => __bootMark('webContents did-finish-load'));
  // The window is shown immediately on creation; ready-to-show now only marks
  // the renderer's first paint (splash → boot screen handoff).
  __win.once('ready-to-show', () => __bootMark('window ready-to-show (first renderer paint)'));

  // Everything below is non-blocking for first paint — kick off in parallel.
  telemetryService.initialize({ installSource: app.isPackaged ? 'dmg' : 'dev' }).catch((e) => {
    log.warn('telemetry init failed:', e);
  });

  yodaAccountService.on('accountChanged', (username, userId, email) => {
    void telemetryService.identify(username, userId, email);
    void mobileRelayService.initialize().catch((error) => {
      log.warn('Failed to initialize mobile Relay after sign-in', error);
    });
  });
  yodaAccountService.on('accountWillClear', async () => {
    try {
      await mobileRelayService.revoke(AbortSignal.timeout(5_000), true);
    } catch (error) {
      log.warn('Failed to revoke mobile Relay while signing out', error);
    }
  });
  yodaAccountService.on('accountCleared', () => {
    telemetryService.clearIdentity();
    mobileRelayService.disconnect();
  });

  gitWatcherRegistry.initialize();
  prSyncScheduler.initialize();
  appService.initialize();

  agentHookService.initialize().catch((e) => {
    log.error('Failed to start agent event service:', e);
  });

  // Finish archives that were requested but interrupted mid-flight (renderer
  // reload, app crash/quit before the archive completed).
  resumePendingTaskArchives().catch((e) => {
    log.warn('Failed to resume pending task archives:', e);
  });

  // Team Room @-mention routing engine: subscribe to room message posts, then
  // recover any room left mid-turn by a previous app lifetime.
  roomConductor.initialize();
  githubRoomMonitor.initialize();
  roomConductor.resumePending().catch((e) => {
    log.warn('Failed to resume pending team-room turns:', e);
  });

  // The sync mode gates which transports answer at all, so it lands before the
  // gateway starts listening — otherwise a relay-only desktop would briefly be
  // reachable over the LAN on every launch.
  initializeMobileSyncMode()
    .catch((e) => {
      log.error('Failed to apply the mobile sync mode:', e);
    })
    .finally(() => {
      mobileGatewayService.initialize().catch((e) => {
        log.error('Failed to start mobile gateway service:', e);
      });
    });

  automationScheduler.initialize().catch((e) => {
    log.error('Failed to start automation scheduler:', e);
  });
  issueWorkerService.initialize();

  yodaAccountService
    .loadSessionToken()
    .then(() => mobileRelayService.initialize())
    .catch((e) => {
      log.warn('Failed to load account session token or initialize Relay:', e);
    });

  // Dependency probe shells out to user tools, so wait for the login-shell
  // PATH to land before probing — otherwise nvm/mise-managed binaries miss.
  void userEnvReady.then(() => {
    modelProviderCatalogService.refreshAutomatically().catch((e) => {
      log.warn('Failed to refresh the model provider catalog:', e);
    });

    runtimeModelCandidatesService.refreshStartupModelCatalog().catch((e) => {
      log.warn('Failed to refresh provider model catalog:', e);
    });

    localDependencyManager.probeAll().catch((e) => {
      log.error('Failed to probe dependencies:', e);
    });
  });

  updateService.initialize().catch((error) => {
    if (app.isPackaged) {
      log.error('Failed to initialize auto-update service:', error);
    }
  });
});

// In dev, the parent script sends SIGTERM on Ctrl+C. Convert it to app.quit()
// so before-quit runs (DB / PTY / git watchers get cleaned up).
process.on('SIGTERM', () => app.quit());
process.on('SIGINT', () => app.quit());

let shutdownStarted = false;
let shutdownPromise: Promise<void> | null = null;
// The menu only records the user's intent. Relaunch must be registered after
// async teardown completes because app.exit() is the final exit path here.
let restartRequested = false;

function requestRestart(): void {
  if (shutdownStarted) return;
  restartRequested = true;
  app.quit();
}

function prepareShutdown(mode: TeardownMode): Promise<void> {
  if (shutdownPromise) return shutdownPromise;

  shutdownStarted = true;
  markAppQuitting();
  telemetryService.capture('app_closed');
  shutdownPromise = (async () => {
    try {
      await telemetryService.dispose();
    } catch (error) {
      log.error('Failed to dispose telemetry during shutdown:', error);
    }

    try {
      agentHookService.dispose();
      sessionSummaryAutoRefreshService.dispose();
      runStateReconcilerService.dispose();
      archivedTaskReactivationService.dispose();
      agentSessionRuntimeStore.dispose();
      aiLabService.dispose();
      mobileGatewayService.dispose();
      mobileRelayService.dispose();
      updateService.dispose();
      prSyncScheduler.dispose();
      promptSourceService.dispose();
      automationScheduler.dispose();
      issueWorkerService.dispose();
      githubRoomMonitor.dispose();
      await cliProxyApiManagedService.dispose();
      await workspaceTerminalService.dispose(mode);
      const [extensionResult, gitWatcherResult, projectManagerResult] = await Promise.allSettled([
        extensionMarketplaceService.dispose(),
        gitWatcherRegistry.dispose(),
        projectManager.dispose({ mode }),
      ]);
      if (extensionResult.status === 'rejected') {
        log.error('Failed to shutdown extension runtimes:', extensionResult.reason);
      }
      if (gitWatcherResult.status === 'rejected') {
        log.error('Failed to shutdown git watcher registry:', gitWatcherResult.reason);
      }
      if (projectManagerResult.status === 'rejected') {
        log.error('Failed to detach project manager:', projectManagerResult.reason);
      }
    } catch (error) {
      log.error('Unexpected error during application shutdown:', error);
    }
  })();
  return shutdownPromise;
}

function relaunchApp(): void {
  if (import.meta.env.DEV) {
    const nodeExecPath = process.env.YODA_DEV_NODE_EXEC_PATH ?? process.env.npm_node_execpath;
    if (nodeExecPath) {
      const devRoot = process.env.YODA_DEV_ROOT ?? app.getAppPath();
      const devRunner = spawn(
        nodeExecPath,
        ['--experimental-strip-types', join(devRoot, 'scripts/dev.ts')],
        {
          cwd: devRoot,
          detached: true,
          stdio: 'ignore',
          env: process.env,
        }
      );
      devRunner.unref();
      return;
    }
  }

  app.relaunch();
}

function beginShutdown(mode: TeardownMode, shouldRelaunch = restartRequested): void {
  void prepareShutdown(mode).finally(() => {
    // Register the relaunch immediately before the final exit so a cancelled
    // quit never leaves a stale relaunch request behind.
    if (shouldRelaunch) relaunchApp();
    app.exit(0);
  });
}

updateService.setPrepareInstallRestart(() => prepareShutdown('terminate'));

app.on('before-quit', (event) => {
  // Once cleanup has completed, the updater must be allowed to own the real
  // quit. Preventing this event makes Squirrel.Mac relaunch the unchanged app.
  if (shutdownStarted) return;

  event.preventDefault();

  const runningAgentSummary = taskManager.getActiveAgentSessionSummary();
  const agentSummary = resolveAgentSessionSummaryForShutdown(
    restartRequested,
    runningAgentSummary,
    restartRequested ? taskManager.getAgentSessions() : []
  );
  const summary = combineActiveSessionSummaries(
    agentSummary,
    workspaceTerminalService.getActiveSessionSummary()
  );
  if (summary.running <= 0) {
    beginShutdown('terminate');
    return;
  }

  const win = BrowserWindow.getAllWindows()[0];
  if (win?.isMinimized()) win.restore();
  // The main window may be hidden (close-to-hide); surface it for the dialog.
  if (win && !win.isDestroyed()) win.show();
  win?.focus();

  const shutdownDecision = resolveQuitAgentSessionsDecision(summary, (options) => {
    const fallbackWin = win && !win.isDestroyed() ? win : undefined;
    return fallbackWin
      ? dialog.showMessageBoxSync(fallbackWin, options)
      : dialog.showMessageBoxSync(options);
  });

  if (shutdownDecision.action === 'cancel') {
    restartRequested = false;
    return;
  }
  beginShutdown(shutdownDecision.mode);
});
