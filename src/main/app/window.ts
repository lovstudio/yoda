import { join } from 'node:path';
import { BrowserWindow, screen } from 'electron';
import appIcon from '@/assets/images/yoda/yoda_logo.png?asset';
import { PRODUCT_NAME } from '@shared/app-identity';
import {
  encodeTaskWindowTarget,
  TASK_WINDOW_TARGET_PARAM,
  TASK_WINDOW_WARM_PARAM,
  type TaskWindowBounds,
  type TaskWindowTarget,
} from '@shared/task-window';
import { telemetryService } from '@main/lib/telemetry';
import { registerExternalLinkHandlers } from '@main/utils/externalLinks';
import { APP_ORIGIN } from './protocol';

let mainWindow: BrowserWindow | null = null;
/** All full-app windows (the main window plus Window > Duplicate copies). */
const fullAppWindows = new Set<BrowserWindow>();

export function createMainWindow(): BrowserWindow {
  mainWindow = createFullAppWindow();
  return mainWindow;
}

/**
 * Window > Duplicate: open another full-app window. Each window runs the whole
 * renderer independently; main-process state (db, sessions) stays shared.
 */
export function duplicateAppWindow(): BrowserWindow {
  const win = createFullAppWindow();
  if (!mainWindow) mainWindow = win;
  return win;
}

function createFullAppWindow(): BrowserWindow {
  const win = createAppWindow();
  fullAppWindows.add(win);
  win.on('closed', () => {
    fullAppWindows.delete(win);
    // Promote a surviving duplicate so deep links / notifications keep a target.
    if (mainWindow === win) {
      mainWindow = fullAppWindows.values().next().value ?? null;
    }
  });
  return win;
}

export function createTaskWindow(target: TaskWindowTarget): BrowserWindow {
  return createAppWindow({ target });
}

/** Spawn an empty, hidden task window that boots its renderer shell and parks. */
export function createWarmTaskWindow(): BrowserWindow {
  return createAppWindow({ warm: true });
}

/** Position a (warm) task window at the drop point, the way a cold one spawns. */
export function positionTaskWindow(win: BrowserWindow, bounds?: TaskWindowBounds): void {
  if (win.isDestroyed()) return;
  const resolved = resolveTaskWindowBounds(bounds);
  if (resolved.x !== undefined && resolved.y !== undefined) {
    win.setBounds({ x: resolved.x, y: resolved.y, width: resolved.width, height: resolved.height });
  } else {
    win.setSize(resolved.width, resolved.height);
  }
}

function createAppWindow(
  options: { target?: TaskWindowTarget; warm?: boolean } = {}
): BrowserWindow {
  const isTaskWindow = Boolean(options.target) || options.warm === true;
  const bounds =
    isTaskWindow && !options.warm
      ? resolveTaskWindowBounds(options.target?.bounds)
      : isTaskWindow
        ? resolveTaskWindowBounds(undefined)
        : { width: 1400, height: 900, x: undefined, y: undefined };

  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    ...(bounds.x !== undefined && bounds.y !== undefined ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: isTaskWindow ? 480 : 700,
    minHeight: isTaskWindow ? 320 : 500,
    title: PRODUCT_NAME,
    backgroundColor: '#111111',
    // In production, electron-builder injects the icon from the app bundle.
    ...(import.meta.env.DEV && { icon: appIcon }),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Required for ESM preload scripts (.mjs)
      sandbox: false,
      // Allow using <webview> in renderer for in‑app browser pane.
      // The webview runs in a separate process; nodeIntegration remains disabled.
      webviewTag: true,
      // __dirname resolves to out/main/ at runtime; preload is at out/preload/index.mjs
      preload: join(__dirname, '../preload/index.mjs'),
    },
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset',
          // Both the main and detached windows use a 40px (h-10) title bar; a
          // ~12px traffic-light cluster centers at (40-12)/2 = 14px from the top.
          trafficLightPosition: { x: 14, y: 14 },
          acceptFirstMouse: true,
        }
      : {}),
    show: false,
  });

  void win.loadURL(rendererUrl(options.target, options.warm));

  // Route external links to the user’s default browser
  registerExternalLinkHandlers(win, import.meta.env.DEV);

  if (!isTaskWindow) {
    // Show the shell immediately instead of waiting for ready-to-show: the
    // renderer bundle takes seconds to load, and the native backgroundColor
    // plus the static splash in index.html paint the same #111111 the boot
    // screen uses — no flash, just a window that exists right away.
    win.show();
  } else if (!options.warm) {
    // Task windows keep the ready-to-show gate (they normally claim a
    // pre-warmed, already-rendered window). Warm windows stay hidden until
    // claimed; the claimer shows them.
    win.once('ready-to-show', () => {
      win.show();
    });
  }

  // Track window focus for telemetry
  win.on('focus', () => {
    telemetryService.capture('app_window_focused');
    if (typeof win.setWindowButtonVisibility === 'function') {
      win.setWindowButtonVisibility(true);
    }
    void telemetryService.checkAndReportDailyActiveUser();
  });

  win.on('blur', () => {
    telemetryService.capture('app_window_unfocused');
  });

  return win;
}

function resolveTaskWindowBounds(bounds: TaskWindowBounds | undefined): {
  width: number;
  height: number;
  x?: number;
  y?: number;
} {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const minWidth = 480;
  const minHeight = 320;
  const maxWidth = Math.max(minWidth, workArea.width - 96);
  const maxHeight = Math.max(minHeight, workArea.height - 96);
  const width = clamp(Math.round(bounds?.width ?? 920), minWidth, maxWidth);
  const height = clamp(Math.round(bounds?.height ?? 640), minHeight, maxHeight);

  return { width, height, ...resolveTaskWindowPosition(bounds?.origin, width, height) };
}

/**
 * Position a torn-out window so its title bar lands under the cursor — i.e. it
 * spawns where the user dropped it. The window is created right after the drag
 * releases while the cursor is still at the drop point, so we read the live OS
 * cursor directly instead of trusting renderer-supplied coordinates. `origin`
 * just gates whether this was a drag-out (vs. menu/right-click open).
 */
function resolveTaskWindowPosition(
  origin: { x: number; y: number } | undefined,
  width: number,
  height: number
): { x: number; y: number } | Record<string, never> {
  if (!origin) return {};

  const cursor = screen.getCursorScreenPoint();
  // Center the window horizontally under the cursor; put the title bar (~14px)
  // at the cursor so the grab point matches where the tab was released.
  const display = screen.getDisplayNearestPoint(cursor);
  const area = display.workArea;
  const x = clamp(Math.round(cursor.x - width / 2), area.x, area.x + area.width - width);
  const y = clamp(Math.round(cursor.y - 14), area.y, area.y + area.height - height);
  return { x, y };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function rendererUrl(target?: TaskWindowTarget, warm?: boolean): string {
  const base = import.meta.env.DEV
    ? process.env.ELECTRON_RENDERER_URL!
    : `${APP_ORIGIN}/index.html`;
  const url = new URL(base);
  if (target) {
    url.searchParams.set(TASK_WINDOW_TARGET_PARAM, encodeTaskWindowTarget(target));
  }
  if (warm) {
    url.searchParams.set(TASK_WINDOW_WARM_PARAM, '1');
  }
  return url.toString();
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
