import { homedir } from 'node:os';
import type { ComparisonWindowTarget } from '@shared/comparison-window';
import type { TaskWindowReturnPayload } from '@shared/events/appEvents';
import { createRPCController } from '@shared/ipc/rpc';
import type { OpenInRequest } from '@shared/openInApps';
import type { TaskWindowTarget } from '@shared/task-window';
import { deepLinkService } from '@main/app/deep-link';
import type { TaskStripDropZone } from '@main/app/task-window-dock';
import { telemetryService } from '@main/lib/telemetry';
import { appService, type SaveTextFileDialogArgs } from './service';
import type { TriggerVoiceInputArgs } from './voice-input';

export const appController = createRPCController({
  openExternal: async (url: string) => {
    try {
      await appService.openExternal(url);
      telemetryService.capture('open_in_external', { app: 'browser' });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  clipboardWriteText: async (text: string) => {
    try {
      appService.clipboardWriteText(text);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  triggerVoiceInput: async (args?: TriggerVoiceInputArgs) => {
    try {
      const result = await appService.triggerVoiceInput(args);
      return { success: true as const, ...result };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
  openTaskWindow: async (target: TaskWindowTarget) => {
    try {
      appService.openTaskWindow(target);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  openComparisonWindow: async (target: ComparisonWindowTarget) => {
    try {
      appService.openComparisonWindow(target);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  focusTaskInMainWindow: async (target: { projectId: string; taskId: string }) => {
    try {
      appService.focusTaskInMainWindow(target);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  notifyTaskWindowReturned: async (payload: TaskWindowReturnPayload) => {
    try {
      appService.notifyTaskWindowReturned(payload);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  registerTaskWindowDock: async (payload: TaskWindowReturnPayload) => {
    try {
      appService.registerTaskWindowDock(payload);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  unregisterTaskWindowDock: async (sourceWindowId: number) => {
    try {
      appService.unregisterTaskWindowDock(sourceWindowId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  setTaskStripDropZone: async (zone: TaskStripDropZone | null) => {
    appService.setTaskStripDropZone(zone);
    return { success: true };
  },
  setLeftSidebarMenuChecked: async (checked: boolean) => {
    appService.setLeftSidebarMenuChecked(checked);
    return { success: true };
  },
  openIn: async (args: OpenInRequest) => {
    try {
      await appService.openIn(args);
      telemetryService.capture('open_in_external', { app: args.app });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  checkInstalledApps: () => appService.checkInstalledApps(),
  listInstalledFonts: async (args?: { refresh?: boolean }) => {
    const { fonts, cached, error } = await appService.listInstalledFonts(args?.refresh);
    return { success: !error, fonts, cached, ...(error ? { error } : {}) };
  },
  openSelectDirectoryDialog: (args: { title: string; message: string }) =>
    appService.openSelectDirectoryDialog(args),
  saveTextFileDialog: async (args: SaveTextFileDialogArgs) => {
    try {
      const result = await appService.saveTextFileDialog(args);
      return { success: true as const, ...result };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
  getAppVersion: () => appService.getCachedAppVersion(),
  getResourceSnapshot: () => appService.getResourceSnapshot(),
  getElectronVersion: () => process.versions.electron,
  getPlatform: () => process.platform,
  getHomeDir: () => homedir(),
  consumePendingDeepLinks: () => deepLinkService.consumePendingTargets(),
});
