import type { BrowserWindow } from 'electron';
import { taskWindowAssignTargetChannel } from '@shared/events/appEvents';
import type { TaskWindowBounds, TaskWindowTarget } from '@shared/task-window';
import { log } from '@main/lib/logger';
import { createTaskWindow, createWarmTaskWindow, positionTaskWindow } from './window';

function poolLog(msg: string): void {
  log.debug(`[task-window-pool] ${msg}`);
}

// A single pre-warmed task window: its renderer shell + providers are already
// booted and parked, so claiming it for a torn-out tab avoids a cold renderer
// boot (~900ms saved). After a claim we immediately warm a replacement.
let warmWindow: BrowserWindow | null = null;
let warming = false;

export function warmTaskWindowPool(): void {
  if (warmWindow && !warmWindow.isDestroyed()) {
    poolLog('warm() skipped, already have a warm window');
    return;
  }
  if (warming) return;
  warming = true;
  try {
    const win = createWarmTaskWindow();
    warmWindow = win;
    poolLog(`warming window id=${win.id}`);
    win.webContents.once('did-finish-load', () =>
      poolLog(`warm window id=${win.id} did-finish-load (ready to claim)`)
    );
    win.once('closed', () => {
      if (warmWindow === win) warmWindow = null;
    });
  } catch (error) {
    log.warn('TaskWindowPool: failed to warm a task window', { error });
  } finally {
    warming = false;
  }
}

/**
 * Open a task window for `target`. Reuses the pre-warmed window when one is
 * ready (instant), otherwise falls back to a cold window. Either way a fresh
 * warm window is queued for the next open.
 */
export function openTaskWindowFromPool(target: TaskWindowTarget): BrowserWindow {
  const win = takeWarmWindow();
  if (win) {
    poolLog('CLAIMED warm window (instant path)');
    claimWarmWindow(win, target);
    warmTaskWindowPool();
    return win;
  }

  poolLog('no warm window ready, COLD fallback');
  const cold = createTaskWindow(target);
  warmTaskWindowPool();
  return cold;
}

function takeWarmWindow(): BrowserWindow | null {
  const win = warmWindow;
  if (!win) {
    poolLog('takeWarm -> none exists');
    return null;
  }
  if (win.isDestroyed()) {
    poolLog('takeWarm -> destroyed');
    return null;
  }
  if (win.webContents.isLoading()) {
    poolLog('takeWarm -> still loading');
    return null;
  }
  warmWindow = null;
  return win;
}

function claimWarmWindow(win: BrowserWindow, target: TaskWindowTarget): void {
  positionTaskWindow(win, target.bounds satisfies TaskWindowBounds | undefined);
  win.webContents.send(taskWindowAssignTargetChannel.name, target);
  win.show();
  win.focus();
}
