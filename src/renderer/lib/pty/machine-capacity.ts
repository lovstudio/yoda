import type { MachineCapacity } from '@shared/app-resource';
import { rpc } from '@renderer/lib/ipc';

let cachedCapacity: MachineCapacity | null = null;
let capacityRequest: Promise<MachineCapacity | null> | null = null;

/** Capacity already known to this renderer, for callers that cannot await. */
export function getCachedMachineCapacity(): MachineCapacity | null {
  return cachedCapacity;
}

/**
 * Installed RAM and core count never change while the app runs, so one RPC per
 * renderer is enough. A failed probe resolves to null rather than throwing: the
 * caller's fallback is the conservative fixed default, not an error. Failures
 * release the shared slot so a later caller can retry.
 */
export function loadMachineCapacity(): Promise<MachineCapacity | null> {
  if (cachedCapacity) return Promise.resolve(cachedCapacity);
  if (capacityRequest) return capacityRequest;

  const request = Promise.resolve()
    .then(() => rpc.app.getMachineCapacity())
    .then((capacity) => {
      cachedCapacity = capacity;
      return capacity;
    })
    .catch(() => null)
    .finally(() => {
      if (capacityRequest === request) capacityRequest = null;
    });
  capacityRequest = request;
  return request;
}

export function invalidateMachineCapacityCache(): void {
  cachedCapacity = null;
  capacityRequest = null;
}
