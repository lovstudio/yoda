import { BrowserWindow, ipcMain } from 'electron';
import { createEventEmitter, type EmitterAdapter } from '@shared/ipc/events';
import { getMainWindow } from '@main/app/window';

const mainWindowEventNames = new Set([
  'deep-link:open',
  'notification:focus-task',
  'app:quit-agent-sessions-requested',
  'task-window:dock-hover',
  'task-window:dock-request',
]);

const focusedWindowEventNames = new Set([
  'menu:check-for-updates',
  'menu:close-tab',
  'menu:open-settings',
  'menu:import-settings',
  'menu:export-settings',
  'menu:sync-settings',
  'menu:redo',
  'menu:undo',
]);

function createMainAdapter(): EmitterAdapter {
  return {
    emit: (eventName: string, data: unknown, topic?: string) => {
      const channel = topic ? `${eventName}.${topic}` : eventName;
      for (const win of targetWindows(eventName)) {
        win.webContents.send(channel, data);
      }
    },
    on: (eventName: string, cb: (data: unknown) => void, topic?: string) => {
      const channel = topic ? `${eventName}.${topic}` : eventName;
      const handler = (_e: Electron.IpcMainEvent, data: unknown) => cb(data);
      ipcMain.on(channel, handler);
      return () => ipcMain.removeListener(channel, handler);
    },
  };
}

function targetWindows(eventName: string): BrowserWindow[] {
  if (mainWindowEventNames.has(eventName)) {
    const win = getMainWindow();
    return win && !win.isDestroyed() ? [win] : [];
  }

  if (focusedWindowEventNames.has(eventName)) {
    const win = BrowserWindow.getFocusedWindow() ?? getMainWindow();
    return win && !win.isDestroyed() ? [win] : [];
  }

  return BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
}

export const events = createEventEmitter(createMainAdapter());
