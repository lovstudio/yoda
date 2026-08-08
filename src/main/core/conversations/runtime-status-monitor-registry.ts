import type { RuntimeStatusMonitorId } from '@shared/runtime-status-monitor';

/** Effective per-session monitor, fixed when a local Agent process starts. */
class RuntimeStatusMonitorRegistry {
  private readonly monitors = new Map<string, RuntimeStatusMonitorId>();

  set(conversationId: string, monitor: RuntimeStatusMonitorId): void {
    this.monitors.set(conversationId, monitor);
  }

  get(conversationId: string): RuntimeStatusMonitorId | undefined {
    return this.monitors.get(conversationId);
  }

  /** Unregistered sessions preserve legacy behavior; registered ones accept one source only. */
  accepts(conversationId: string, monitor: RuntimeStatusMonitorId): boolean {
    const selected = this.monitors.get(conversationId);
    return selected === undefined || selected === monitor;
  }

  remove(conversationId: string): void {
    this.monitors.delete(conversationId);
  }
}

export const runtimeStatusMonitorRegistry = new RuntimeStatusMonitorRegistry();
