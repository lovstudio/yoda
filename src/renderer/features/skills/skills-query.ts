import type { CatalogIndex } from '@shared/skills/types';
import { rpc } from '@renderer/lib/ipc';

export const skillsCatalogQueryKey = ['skills', 'catalog'] as const;
export const skillsQuickCatalogQueryKey = ['skills', 'catalog', 'quick'] as const;

export async function fetchSkillsCatalog(): Promise<CatalogIndex> {
  const result = await rpc.skills.getCatalog();
  if (result.success && result.data) return result.data;
  throw new Error(result.error ?? 'Failed to load catalog');
}

export async function fetchSkillsQuickCatalog(): Promise<CatalogIndex> {
  const result = await rpc.skills.getCatalog({ lightweight: true });
  if (result.success && result.data) return result.data;
  throw new Error(result.error ?? 'Failed to load installed skills');
}

export const skillsCatalogQueryOptions = {
  queryKey: skillsCatalogQueryKey,
  queryFn: fetchSkillsCatalog,
  staleTime: 5 * 60_000,
  gcTime: 30 * 60_000,
} as const;

export const skillsQuickCatalogQueryOptions = {
  queryKey: skillsQuickCatalogQueryKey,
  queryFn: fetchSkillsQuickCatalog,
  staleTime: 5 * 60_000,
  gcTime: 30 * 60_000,
} as const;
