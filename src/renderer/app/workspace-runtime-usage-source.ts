import type { MaasGlobalBindingStatus } from '@shared/maas';
import type { RuntimeId } from '@shared/runtime-registry';

export function isMaasUsageActiveForRuntime(
  runtimeId: RuntimeId | null,
  binding: MaasGlobalBindingStatus | null | undefined
): boolean {
  return Boolean(
    runtimeId &&
      binding?.enabled &&
      binding.effective &&
      binding.platformId &&
      binding.runtimeIds.includes(runtimeId)
  );
}

export function shouldReadOfficialAccountUsage(
  runtimeId: RuntimeId | null,
  connectionId: string | undefined,
  maasActiveForRuntime: boolean
): boolean {
  return runtimeId === 'codex' && !connectionId && !maasActiveForRuntime;
}
