import type { ModelProviderCatalogResult } from '@shared/model-provider-catalog';
import { modelProviderCatalogService } from '@main/core/settings/model-provider-catalog-service';

export function listModelProviders(): Promise<ModelProviderCatalogResult> {
  return modelProviderCatalogService.list();
}

export function refreshModelProviders(providerId?: string): Promise<ModelProviderCatalogResult> {
  return modelProviderCatalogService.refresh({ providerId, reason: 'manual' });
}

export function setModelProviderAutomaticUpdates(
  enabled: boolean
): Promise<ModelProviderCatalogResult> {
  return modelProviderCatalogService.setAutomaticUpdatesEnabled(enabled);
}

export function updateModelProviderCustomModels(
  providerId: string,
  customModels: string[]
): Promise<ModelProviderCatalogResult> {
  return modelProviderCatalogService.updateCustomModels(providerId, customModels);
}
