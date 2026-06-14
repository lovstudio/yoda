import { createRPCController } from '@/shared/ipc/rpc';
import { pluginsService } from '@main/core/plugins/PluginsService';
import { log } from '@main/lib/logger';

export const pluginsController = createRPCController({
  getIndex: async () => {
    try {
      const index = await pluginsService.getIndex();
      return { success: true, data: index };
    } catch (error) {
      log.error('Failed to get plugins index:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  refresh: async () => {
    try {
      const index = await pluginsService.refresh();
      return { success: true, data: index };
    } catch (error) {
      log.error('Failed to refresh plugins index:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  setEnabled: async (args: { pluginId: string; enabled: boolean }) => {
    try {
      const plugin = await pluginsService.setEnabled(args.pluginId, args.enabled);
      return { success: true, data: plugin };
    } catch (error) {
      log.error('Failed to update plugin enabled state:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  uninstall: async (args: { pluginId: string }) => {
    try {
      await pluginsService.uninstall(args.pluginId);
      return { success: true };
    } catch (error) {
      log.error('Failed to uninstall plugin:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
