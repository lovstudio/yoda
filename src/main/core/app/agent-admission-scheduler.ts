import { cpus, freemem, totalmem } from 'node:os';
import type { AgentAdmissionSnapshot } from '@shared/app-resource';
import { agentSessionRuntimeStore } from '@main/core/conversations/agent-session-runtime';
import { appSettingsService } from '@main/core/settings/settings-service';
import { calculateAutomaticAgentLimit } from './agent-admission-policy';

const ADMISSION_POLL_MS = 500;

class AgentAdmissionScheduler {
  private readonly reservations = new Set<string>();
  private queued = 0;
  private lastSnapshot: AgentAdmissionSnapshot = {
    mode: 'auto',
    configuredLimit: 4,
    effectiveLimit: 1,
    memoryUsedPercent: 0,
    queued: 0,
    pausedReason: null,
  };

  async admit(sessionId: string, isCurrent: () => boolean): Promise<(() => void) | null> {
    this.queued += 1;
    try {
      while (isCurrent()) {
        const snapshot = await this.refreshSnapshot();
        if (snapshot.mode === 'unlimited' || snapshot.pausedReason === null) {
          this.reservations.add(sessionId);
          return () => this.reservations.delete(sessionId);
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, ADMISSION_POLL_MS);
          timer.unref?.();
        });
      }
      return null;
    } finally {
      this.queued = Math.max(0, this.queued - 1);
    }
  }

  async getSnapshot(): Promise<AgentAdmissionSnapshot> {
    return this.refreshSnapshot();
  }

  private async refreshSnapshot(): Promise<AgentAdmissionSnapshot> {
    const settings = await appSettingsService.get('terminal');
    const totalMemoryBytes = totalmem();
    const memoryUsedPercent =
      totalMemoryBytes > 0
        ? Math.round(((totalMemoryBytes - freemem()) / totalMemoryBytes) * 1_000) / 10
        : 0;
    const effectiveLimit =
      settings.agentConcurrencyMode === 'auto'
        ? calculateAutomaticAgentLimit(totalMemoryBytes, cpus().length)
        : settings.agentConcurrencyMode === 'fixed'
          ? settings.agentConcurrencyLimit
          : Number.MAX_SAFE_INTEGER;
    const activeCount = agentSessionRuntimeStore.getAllStatuses().length + this.reservations.size;
    const pausedReason =
      settings.agentConcurrencyMode !== 'unlimited' &&
      memoryUsedPercent >= settings.agentMemoryPausePercent
        ? 'memory'
        : settings.agentConcurrencyMode !== 'unlimited' && activeCount >= effectiveLimit
          ? 'concurrency'
          : null;
    this.lastSnapshot = {
      mode: settings.agentConcurrencyMode,
      configuredLimit: settings.agentConcurrencyLimit,
      effectiveLimit,
      memoryUsedPercent,
      queued: this.queued,
      pausedReason,
    };
    return this.lastSnapshot;
  }
}

export const agentAdmissionScheduler = new AgentAdmissionScheduler();
