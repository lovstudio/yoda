import { getRuntime, type RuntimeId } from './runtime-registry';

export const RUNTIME_STATUS_MONITOR_IDS = [
  'activity',
  'transcript',
  'rollout',
  'hooks',
  'terminal',
] as const;

export type RuntimeStatusMonitorId = (typeof RUNTIME_STATUS_MONITOR_IDS)[number];

export type RuntimeStatusMonitorDefinition = {
  id: RuntimeStatusMonitorId;
  recommended?: boolean;
};

const CLAUDE_STATUS_MONITORS: readonly RuntimeStatusMonitorDefinition[] = [
  { id: 'activity', recommended: true },
  { id: 'transcript' },
  { id: 'hooks' },
];

const CODEX_STATUS_MONITORS: readonly RuntimeStatusMonitorDefinition[] = [
  { id: 'rollout', recommended: true },
  { id: 'hooks' },
];

/** Status mechanisms supported by one Agent Client, in default-preference order. */
export function getRuntimeStatusMonitors(
  runtimeId: RuntimeId
): readonly RuntimeStatusMonitorDefinition[] {
  if (runtimeId === 'claude') return CLAUDE_STATUS_MONITORS;
  if (runtimeId === 'codex') return CODEX_STATUS_MONITORS;
  return getRuntime(runtimeId)?.supportsHooks
    ? [{ id: 'hooks', recommended: true }, { id: 'terminal' }]
    : [{ id: 'terminal', recommended: true }];
}

export function getDefaultRuntimeStatusMonitor(runtimeId: RuntimeId): RuntimeStatusMonitorId {
  return getRuntimeStatusMonitors(runtimeId)[0]?.id ?? 'terminal';
}

/** Invalid or stale selections degrade to the client's recommended mechanism. */
export function resolveRuntimeStatusMonitor(
  runtimeId: RuntimeId,
  configured: string | null | undefined
): RuntimeStatusMonitorId {
  const available = getRuntimeStatusMonitors(runtimeId);
  return (
    available.find((item) => item.id === configured)?.id ??
    getDefaultRuntimeStatusMonitor(runtimeId)
  );
}
