import { join } from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import dockIcon from '@/assets/images/yoda/icon-dock.png?asset';
import { PRODUCT_NAME } from '@shared/app-identity';
import { registerRPCRouter } from '@shared/ipc/rpc';
import { deepLinkService } from './app/deep-link';
import { setupApplicationMenu } from './app/menu';
import { registerAppScheme, setupAppProtocol } from './app/protocol';
import { warmTaskWindowPool } from './app/task-window-pool';
import { createMainWindow, focusExistingFullAppWindow, markAppQuitting } from './app/window';
import { registerWindowIpc } from './app/window-ipc';
import { yodaAccountService } from './core/account/services/yoda-account-service';
import { agentHookService } from './core/agent-hooks/agent-hook-service';
import { resolveQuitAgentSessionsDecision } from './core/app/quit-agent-sessions';
import { appService } from './core/app/service';
import { automationScheduler } from './core/automation/automation-scheduler';
import { agentSessionRuntimeStore } from './core/conversations/agent-session-runtime';
import { localDependencyManager } from './core/dependencies/dependency-manager';
import { knownBinDirs } from './core/dependencies/probe';
import { editorBufferService } from './core/editor/editor-buffer-service';
import { gitWatcherRegistry } from './core/git/git-watcher-registry';
import { mobileGatewayService } from './core/mobile-gateway/mobile-gateway-service';
import { ensureInternalProject } from './core/projects/operations/ensureInternalProject';
import { projectManager } from './core/projects/project-manager';
import { ptySessionRegistry } from './core/pty/pty-session-registry';
import { prSyncScheduler } from './core/pull-requests/pr-sync-scheduler';
import { reviewOrchestrator } from './core/review-orchestration/orchestrator';
import { searchService } from './core/search/search-service';
import { runtimeModelCandidatesService } from './core/settings/runtime-model-candidates-service';
import { appSettingsService } from './core/settings/settings-service';
import { resumePendingTaskArchives } from './core/tasks/operations/archiveTask';
import { taskManager } from './core/tasks/task-manager';
import { roomConductor } from './core/team-rooms/conductor';
import { updateService } from './core/updates/update-service';
import { viewStateService } from './core/view-state/view-state-service';
import type { TeardownMode } from './core/workspaces/workspace-registry';
import { initializeDatabase } from './db/initialize';
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

app.setName(PRODUCT_NAME);

const yodaUserData = join(app.getPath('appData'), 'yoda');
app.setPath('userData', yodaUserData);

function createMainWindowWithDeepLinkReset(): BrowserWindow {
  deepLinkService.markRendererNotReady();
  const win = createMainWindow();
  win.webContents.on('did-start-loading', () => deepLinkService.markRendererNotReady());
  return win;
}

app.on('second-instance', (_event, argv) => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win?.isMinimized()) win.restore();
  win?.focus();
  deepLinkService.enqueueArgv(argv);
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
  agentSessionRuntimeStore.initialize();

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
  ptySessionRegistry.setScrollbackLines((await appSettingsService.get('terminal')).scrollbackLines);
  __bootMark('appSettingsService.initialize done');

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

  setupAppProtocol(join(app.getAppPath(), 'out', 'renderer'));
  await setupApplicationMenu();
  __bootMark('protocol + menu done');
  const __win = createMainWindowWithDeepLinkReset();
  __bootMark('createMainWindow returned');
  __win.webContents.once('did-start-loading', () => __bootMark('webContents did-start-loading'));
  __win.webContents.once('dom-ready', () => __bootMark('webContents dom-ready'));
  __win.webContents.once('did-finish-load', () => {
    __bootMark('webContents did-finish-load');
    // Pre-warm a hidden task window so the first tab tear-out opens instantly.
    // Deferred so it doesn't compete with the main window's own boot.
    setTimeout(() => warmTaskWindowPool(), 1500);
  });
  // The window is shown immediately on creation; ready-to-show now only marks
  // the renderer's first paint (splash → boot screen handoff).
  __win.once('ready-to-show', () => __bootMark('window ready-to-show (first renderer paint)'));

  // Everything below is non-blocking for first paint — kick off in parallel.
  telemetryService.initialize({ installSource: app.isPackaged ? 'dmg' : 'dev' }).catch((e) => {
    log.warn('telemetry init failed:', e);
  });

  yodaAccountService.on('accountChanged', (username, userId, email) => {
    void telemetryService.identify(username, userId, email);
  });
  yodaAccountService.on('accountCleared', () => {
    telemetryService.clearIdentity();
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

  // Resume review-mode orchestrations interrupted mid-flight (reload, crash).
  reviewOrchestrator.resumePending().catch((e) => {
    log.warn('Failed to resume pending review orchestrations:', e);
  });

  // Team Room @-mention routing engine: subscribe to room message posts, then
  // recover any room left mid-turn by a previous app lifetime.
  roomConductor.initialize();
  roomConductor.resumePending().catch((e) => {
    log.warn('Failed to resume pending team-room turns:', e);
  });

  mobileGatewayService.initialize().catch((e) => {
    log.error('Failed to start mobile gateway service:', e);
  });

  automationScheduler.initialize().catch((e) => {
    log.error('Failed to start automation scheduler:', e);
  });

  yodaAccountService.loadSessionToken().catch((e) => {
    log.warn('Failed to load account session token:', e);
  });

  // Dependency probe shells out to user tools, so wait for the login-shell
  // PATH to land before probing — otherwise nvm/mise-managed binaries miss.
  void userEnvReady.then(() => {
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

function beginShutdown(mode: TeardownMode): void {
  if (shutdownStarted) return;

  shutdownStarted = true;
  markAppQuitting();
  telemetryService.capture('app_closed');
  void telemetryService.dispose().finally(() => {
    void (async () => {
      try {
        agentHookService.dispose();
        agentSessionRuntimeStore.dispose();
        mobileGatewayService.dispose();
        updateService.dispose();
        prSyncScheduler.dispose();
        const [gitWatcherResult, projectManagerResult] = await Promise.allSettled([
          gitWatcherRegistry.dispose(),
          projectManager.dispose({ mode }),
        ]);
        if (gitWatcherResult.status === 'rejected') {
          log.error('Failed to shutdown git watcher registry:', gitWatcherResult.reason);
        }
        if (projectManagerResult.status === 'rejected') {
          log.error('Failed to detach project manager:', projectManagerResult.reason);
        }
      } finally {
        app.quit();
      }
    })();
  });
}

app.on('before-quit', (event) => {
  if (shutdownStarted) return;
  event.preventDefault();

  const summary = taskManager.getActiveAgentSessionSummary();
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

  if (shutdownDecision.action === 'cancel') return;
  beginShutdown(shutdownDecision.mode);
});
