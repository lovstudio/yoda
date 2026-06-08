import { join } from 'node:path';
import { app, Menu, shell } from 'electron';
import {
  menuCheckForUpdatesChannel,
  menuCloseTabChannel,
  menuOpenSettingsChannel,
  menuRedoChannel,
  menuUndoChannel,
} from '@shared/events/appEvents';
import { YODA_DOCS_URL, YODA_RELEASES_URL } from '@shared/urls';
import { resolveAppVersion } from '@main/core/app/utils';
import { events } from '@main/lib/events';

function restartApp(): void {
  if (import.meta.env.DEV) {
    const nodeExecPath = process.env.npm_node_execpath;
    if (nodeExecPath) {
      app.relaunch({
        execPath: nodeExecPath,
        args: ['--experimental-strip-types', join(process.cwd(), 'scripts/dev.ts')],
      });
      app.quit();
      return;
    }
  }

  app.relaunch();
  app.quit();
}

function configureAboutPanel(appVersion: string): void {
  app.setAboutPanelOptions({
    applicationName: app.name,
    applicationVersion: appVersion,
  });
}

export async function setupApplicationMenu(): Promise<void> {
  const isMac = process.platform === 'darwin';
  const appVersion = await resolveAppVersion();

  configureAboutPanel(appVersion);

  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS app menu
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              {
                label: `About ${app.name} (${appVersion})`,
                click: () => app.showAboutPanel(),
              },
              { type: 'separator' as const },
              {
                label: 'Settings\u2026',
                accelerator: 'CmdOrCtrl+,',
                click: () => events.emit(menuOpenSettingsChannel, undefined),
              },
              {
                label: 'Check for Updates\u2026',
                click: () => events.emit(menuCheckForUpdatesChannel, undefined),
              },
              {
                label: `Restart ${app.name}`,
                click: restartApp,
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              {
                label: `Quit ${app.name}`,
                accelerator: 'CmdOrCtrl+Q',
                click: () => app.quit(),
              },
            ],
          } as Electron.MenuItemConstructorOptions,
        ]
      : []),
    // File menu
    {
      label: 'File',
      submenu: [
        // On non-macOS, put Settings in File menu
        ...(!isMac
          ? [
              {
                label: 'Settings\u2026',
                accelerator: 'CmdOrCtrl+,',
                click: () => events.emit(menuOpenSettingsChannel, undefined),
              },
              {
                label: `Restart ${app.name}`,
                click: restartApp,
              },
              { type: 'separator' as const },
            ]
          : []),
        isMac
          ? {
              label: 'Close Tab',
              accelerator: 'CmdOrCtrl+W',
              click: () => events.emit(menuCloseTabChannel, undefined),
            }
          : { role: 'quit' as const },
      ],
    },
    // Edit menu
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => events.emit(menuUndoChannel, undefined),
        },
        {
          label: 'Redo',
          accelerator: isMac ? 'Shift+CmdOrCtrl+Z' : 'CmdOrCtrl+Y',
          click: () => events.emit(menuRedoChannel, undefined),
        },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        ...(isMac ? [{ role: 'pasteAndMatchStyle' as const }] : []),
        { role: 'delete' as const },
        { role: 'selectAll' as const },
      ],
    },
    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    },
    // Window menu
    { role: 'windowMenu' as const },
    // Help menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'Docs',
          click: () => {
            void shell.openExternal(YODA_DOCS_URL);
          },
        },
        {
          label: 'Changelog',
          click: () => {
            void shell.openExternal(YODA_RELEASES_URL);
          },
        },
        ...(!isMac
          ? [
              { type: 'separator' as const },
              {
                label: 'Check for Updates\u2026',
                click: () => events.emit(menuCheckForUpdatesChannel, undefined),
              },
            ]
          : []),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
