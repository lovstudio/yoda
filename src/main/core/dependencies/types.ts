import type { DependencyCategory, DependencyId, DependencyStatus } from '@shared/dependencies';
import type { IExecutionContext } from '@main/core/execution-context/types';

export interface ProbeResult {
  command: string;
  path: string | null;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export interface DependencyDescriptor {
  id: DependencyId;
  name: string;
  category: DependencyCategory;
  /** Binary names to try in order; first success wins. */
  commands: string[];
  /** Args passed when probing for a version string. Defaults to ['--version']. */
  versionArgs?: string[];
  docUrl?: string;
  /** Human-readable installation hint shown in UI. */
  installHint?: string;
  /** Machine-executable install command, e.g. "npm install -g @openai/codex". */
  installCommand?: string;
  /** Resolve a machine-executable install command from the execution target. */
  resolveInstallCommand?: (ctx: IExecutionContext) => Promise<string | undefined>;
  /**
   * Override the default status resolution logic.
   * Useful for CLIs that exit non-zero on `--version` but are still available.
   */
  resolveStatus?: (result: ProbeResult) => DependencyStatus;
}
