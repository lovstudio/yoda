import type { DependencyState } from './dependencies';
import type { AgentAccountProviderId, RuntimeId } from './runtime-registry';

export type RuntimeSnapshot = {
  runtimeId: RuntimeId;
  installation: DependencyState | null;
  update: {
    command: string | null;
    latestVersion: string | null;
    lastCheckedAt: string | null;
    available: boolean | null;
  };
  model: {
    defaultModel: string | null;
    nativeModel: string | null;
    provider: string | null;
  };
  config: {
    path: string | null;
    exists: boolean | null;
    cli: string | null;
    defaultArgs: string[];
    extraArgs: string | null;
    authProvider: AgentAccountProviderId | null;
    envKeys: string[];
  };
  checkedAt: number;
};
