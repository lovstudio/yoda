import { type MaasPlatformId, type MaasPlatformInfoSnapshot } from '@shared/maas';
import { KV } from '@main/db/kv';

type MaasPlatformInfoKVSchema = Record<string, MaasPlatformInfoSnapshot>;

const platformInfoKV = new KV<MaasPlatformInfoKVSchema>('maas-platform-info');

export async function getMaasPlatformInfoSnapshot(
  platformId: MaasPlatformId
): Promise<MaasPlatformInfoSnapshot | null> {
  return platformInfoKV.get(platformId);
}

export async function setMaasPlatformInfoSnapshot(
  platformId: MaasPlatformId,
  snapshot: MaasPlatformInfoSnapshot
): Promise<void> {
  await platformInfoKV.set(platformId, snapshot);
}
