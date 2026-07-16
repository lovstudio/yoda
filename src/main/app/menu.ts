import { join } from 'node:path';
import { app, Menu, shell } from 'electron';
import {
  menuCheckForUpdatesChannel,
  menuCloseTabChannel,
  menuExportSettingsChannel,
  menuImportSettingsChannel,
  menuOpenSettingsChannel,
  menuRedoChannel,
  menuSyncSettingsChannel,
  menuToggleLeftSidebarChannel,
  menuUndoChannel,
} from '@shared/events/appEvents';
import { YODA_DOCS_URL, YODA_RELEASES_URL } from '@shared/urls';
import { resolveAppVersion } from '@main/core/app/utils';
import { events } from '@main/lib/events';
import { duplicateAppWindow } from './window';

const LEFT_SIDEBAR_MENU_ITEM_ID = 'view.toggleLeftSidebar';

export function setLeftSidebarMenuChecked(checked: boolean): void {
  const menu = Menu.getApplicationMenu();
  if (!menu) return;
  const item = menu.getMenuItemById(LEFT_SIDEBAR_MENU_ITEM_ID);
  if (!item) return;
  item.checked = checked;
}

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
    // dev 壳的 CFBundleVersion 是 Electron 版本，不覆盖会显示成 0.x.x (41.x.x)
    version: appVersion,
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
              {
                label: 'Check for Updates\u2026',
                click: () => events.emit(menuCheckForUpdatesChannel, undefined),
              },
              { type: 'separator' as const },
              {
                label: 'Settings\u2026',
                accelerator: 'CmdOrCtrl+,',
                click: () => events.emit(menuOpenSettingsChannel, undefined),
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              {
                label: `Restart ${app.name}`,
                click: restartApp,
              },
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
        {
          label: 'Manage Settings',
          submenu: [
            {
              label: 'Import Settings\u2026',
              click: () => events.emit(menuImportSettingsChannel, undefined),
            },
            {
              label: 'Export Settings\u2026',
              click: () => events.emit(menuExportSettingsChannel, undefined),
            },
            { type: 'separator' as const },
            {
              label: 'Sync Settings Now',
              click: () => events.emit(menuSyncSettingsChannel, undefined),
            },
          ],
        },
        { type: 'separator' as const },
        // On non-macOS, put Settings in File menu
        ...(!isMac
          ? [
              {
                label: 'Settings\u2026',
                accelerator: 'CmdOrCtrl+,',
                click: () => events.emit(menuOpenSettingsChannel, undefined),
              },
              { type: 'separator' as const },
              {
                label: `Restart ${app.name}`,
                click: restartApp,
              },
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
        {
          id: LEFT_SIDEBAR_MENU_ITEM_ID,
          label: 'Show Left Sidebar',
          type: 'checkbox' as const,
          checked: true,
          accelerator: 'CmdOrCtrl+B',
          // Renderer owns the hotkey (user-configurable). Display the accelerator
          // as a visual hint without registering it, so we don't double-toggle.
          registerAccelerator: false,
          click: () => events.emit(menuToggleLeftSidebarChannel, undefined),
        },
        { type: 'separator' as const },
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
    // Window menu (custom: default roles + Duplicate)
    {
      label: 'Window',
      role: 'window' as const,
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        { type: 'separator' as const },
        {
          // Open another full-app window that operates independently.
          label: 'Duplicate',
          accelerator: 'Shift+CmdOrCtrl+D',
          click: () => duplicateAppWindow(),
        },
        ...(isMac
          ? [{ type: 'separator' as const }, { role: 'front' as const }]
          : [{ role: 'close' as const }]),
      ],
    },
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
