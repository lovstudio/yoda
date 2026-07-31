import type { ModelProviderCatalogResult } from '@shared/model-provider-catalog';
import { modelProviderCatalogService } from '@main/core/settings/model-provider-catalog-service';

export function listModelProviders(args?: {
  forceRefresh?: boolean;
}): Promise<ModelProviderCatalogResult> {
  return modelProviderCatalogService.list(args);
}

export function updateModelProviderCustomModels(
  providerId: string,
  customModels: string[]
): Promise<ModelProviderCatalogResult> {
  return modelProviderCatalogService.updateCustomModels(providerId, customModels);
}
