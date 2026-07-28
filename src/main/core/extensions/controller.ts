import { MAAS_GATEWAY_EXTENSION_ID, type YodaExtensionInstallInput } from '@shared/extensions';
import { createRPCController } from '@shared/ipc/rpc';
import { maasService } from '@main/core/maas/maas-service';
import { log } from '@main/lib/logger';
import { extensionMarketplaceService } from './extension-marketplace-service';

async function disableMaasBeforeGatewayMutation(): Promise<void> {
  const binding = await maasService.getGlobalBinding();
  if (!binding.enabled || !binding.platformId) return;
  const result = await maasService.setGlobalBinding({
    platformId: binding.platformId,
    enabled: false,
  });
  if (!result.success) {
    throw new Error(result.error ?? 'Failed to restore MaaS client configuration.');
  }
}

export const extensionsController = createRPCController({
  listMarketplace: async () => extensionMarketplaceService.listMarketplace(),

  getExtension: async (args: { extensionId: string }) =>
    extensionMarketplaceService.getExtension(args.extensionId),

  install: async (input: YodaExtensionInstallInput) => {
    try {
      const extension = await extensionMarketplaceService.install(input);
      return { success: true, extension };
    } catch (error) {
      log.error('Failed to install Yoda extension', { error: String(error) });
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  setEnabled: async (args: { extensionId: string; enabled: boolean }) => {
    try {
      if (args.extensionId === MAAS_GATEWAY_EXTENSION_ID && !args.enabled) {
        await disableMaasBeforeGatewayMutation();
      }
      const extension = await extensionMarketplaceService.setEnabled(
        args.extensionId,
        args.enabled
      );
      return { success: true, extension };
    } catch (error) {
      log.error('Failed to update Yoda extension', { error: String(error) });
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  uninstall: async (args: { extensionId: string }) => {
    try {
      if (args.extensionId === MAAS_GATEWAY_EXTENSION_ID) {
        await disableMaasBeforeGatewayMutation();
      }
      await extensionMarketplaceService.uninstall(args.extensionId);
      return { success: true };
    } catch (error) {
      log.error('Failed to uninstall Yoda extension', { error: String(error) });
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
