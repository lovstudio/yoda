import { app, shell } from 'electron';
import { createRPCController } from '@shared/ipc/rpc';
import { YODA_RELEASES_URL } from '@shared/urls';
import { updateService } from '@main/core/updates/update-service';
import { formatUpdaterError } from './utils';

export const updateController = createRPCController({
  check: async () => {
    try {
      if (!updateService.isActive()) {
        return { success: true, result: null, serviceActive: false };
      }
      const result = await updateService.checkForUpdates();
      return { success: true, result: result ?? null, serviceActive: true };
    } catch (error) {
      return { success: false, error: formatUpdaterError(error) };
    }
  },

  download: async () => {
    try {
      await updateService.downloadUpdate();
      return { success: true };
    } catch (error) {
      return { success: false, error: formatUpdaterError(error) };
    }
  },

  quitAndInstall: async () => {
    try {
      updateService.quitAndInstall();
      return { success: true };
    } catch (error) {
      return { success: false, error: formatUpdaterError(error) };
    }
  },

  openLatest: async () => {
    try {
      await shell.openExternal(YODA_RELEASES_URL);
      setTimeout(() => {
        try {
          app.quit();
        } catch {}
      }, 500);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  // Opens the releases page in the system browser WITHOUT quitting. The browser
  // uses the OS proxy, so this is the reliable manual-download fallback when the
  // in-app updater can't reach GitHub.
  openReleasePage: async () => {
    try {
      await shell.openExternal(YODA_RELEASES_URL);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  getState: async () => {
    try {
      const state = updateService.getState();
      return { success: true, data: state };
    } catch (error) {
      return { success: false, error: formatUpdaterError(error) };
    }
  },

  getReleaseNotes: async () => {
    try {
      const notes = await updateService.fetchReleaseNotes();
      return { success: true, data: notes };
    } catch (error) {
      return { success: false, error: formatUpdaterError(error) };
    }
  },
});
