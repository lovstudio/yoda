import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type CachedSample<T> = {
  value: T;
  sampledAt: number;
};

/**
 * Keeps expensive samplers single-flight and briefly reuses their last result.
 * The TTL starts when sampling completes so a slow sample is not immediately
 * considered stale.
 */
export class TtlSingleFlightSampler<T> {
  private cached: CachedSample<T> | null = null;
  private inFlight: Promise<T> | null = null;
  private generation = 0;

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now
  ) {
    if (!Number.isFinite(ttlMs) || ttlMs < 0) {
      throw new Error('Sampler TTL must be a non-negative finite number.');
    }
  }

  sample(load: () => Promise<T>, maxAgeMs: number = this.ttlMs): Promise<T> {
    if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
      return Promise.reject(new Error('Sampler max age must be a non-negative finite number.'));
    }
    const cached = this.cached;
    if (cached && this.now() - cached.sampledAt < maxAgeMs) {
      return Promise.resolve(cached.value);
    }
    if (this.inFlight) return this.inFlight;

    const generation = this.generation;
    const inFlight = Promise.resolve()
      .then(load)
      .then((value) => {
        if (generation === this.generation) {
          this.cached = { value, sampledAt: this.now() };
        }
        return value;
      })
      .finally(() => {
        if (this.inFlight === inFlight) this.inFlight = null;
      });
    this.inFlight = inFlight;
    return inFlight;
  }

  clear(): void {
    this.generation += 1;
    this.cached = null;
    this.inFlight = null;
  }
}

export type ProcessTreeResource = {
  pid: number;
  cpuPercent: number;
  memoryBytes: number;
};

export const AGENT_PROCESS_VISIBLE_MAX_AGE_MS = 4_000;
export const AGENT_PROCESS_HIDDEN_MAX_AGE_MS = 5 * 60_000;

export function getAgentProcessSampleMaxAge(freshAgentProcesses: boolean): number {
  return freshAgentProcesses ? AGENT_PROCESS_VISIBLE_MAX_AGE_MS : AGENT_PROCESS_HIDDEN_MAX_AGE_MS;
}

type ProcessRow = ProcessTreeResource & {
  parentPid: number;
};

function parseProcessRows(stdout: string): ProcessRow[] {
  return stdout.split('\n').flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)/);
    if (!match) return [];
    return [
      {
        pid: Number(match[1]),
        parentPid: Number(match[2]),
        cpuPercent: Number(match[3]),
        memoryBytes: Number(match[4]) * 1024,
      },
    ];
  });
}

export function aggregateProcessTree(rows: ProcessRow[], rootPid: number): ProcessTreeResource {
  return (
    aggregateProcessTrees(rows, [rootPid]).get(rootPid) ?? {
      pid: rootPid,
      cpuPercent: 0,
      memoryBytes: 0,
    }
  );
}

/**
 * Aggregates several process trees from one shared index. Resource snapshots
 * commonly contain dozens of agent roots; rebuilding the parent/child map and
 * rescanning every `ps` row once per root turns that sample into O(roots ×
 * processes) work on the main thread.
 */
export function aggregateProcessTrees(
  rows: ProcessRow[],
  rootPids: readonly number[]
): Map<number, ProcessTreeResource> {
  const children = new Map<number, number[]>();
  const rowByPid = new Map<number, ProcessRow>();
  for (const row of rows) {
    rowByPid.set(row.pid, row);
    const list = children.get(row.parentPid) ?? [];
    list.push(row.pid);
    children.set(row.parentPid, list);
  }

  return new Map(
    rootPids.map((rootPid) => {
      const included = new Set<number>();
      const pending = [rootPid];
      let representativePid = rootPid;
      let representativeMemory = -1;
      let cpuPercent = 0;
      let memoryBytes = 0;

      while (pending.length > 0) {
        const pid = pending.pop();
        if (pid === undefined || included.has(pid)) continue;
        included.add(pid);
        pending.push(...(children.get(pid) ?? []));

        const row = rowByPid.get(pid);
        if (!row) continue;
        cpuPercent += row.cpuPercent;
        memoryBytes += row.memoryBytes;
        if (row.memoryBytes > representativeMemory) {
          representativeMemory = row.memoryBytes;
          representativePid = row.pid;
        }
      }

      return [
        rootPid,
        {
          pid: representativePid,
          cpuPercent: Math.round(cpuPercent * 10) / 10,
          memoryBytes,
        },
      ] as const;
    })
  );
}

export async function sampleProcessTrees(
  rootPids: number[]
): Promise<Map<number, ProcessTreeResource>> {
  const uniquePids = [...new Set(rootPids.filter((pid) => Number.isSafeInteger(pid) && pid > 0))];
  if (uniquePids.length === 0 || process.platform === 'win32') return new Map();
  try {
    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,%cpu=,rss=']);
    const rows = parseProcessRows(stdout);
    return aggregateProcessTrees(rows, uniquePids);
  } catch {
    return new Map();
  }
}

type ProcessTreeSampleCache = {
  rootPids: Set<number>;
  value: Map<number, ProcessTreeResource>;
  sampledAt: number;
};

type ProcessTreeSampleInFlight = {
  rootPids: Set<number>;
  promise: Promise<Map<number, ProcessTreeResource>>;
};

type ProcessTreeSampleLoader = (rootPids: number[]) => Promise<Map<number, ProcessTreeResource>>;

function normalizeRootPids(rootPids: readonly number[]): number[] {
  return [...new Set(rootPids.filter((pid) => Number.isSafeInteger(pid) && pid > 0))].sort(
    (left, right) => left - right
  );
}

function containsEveryPid(container: ReadonlySet<number>, rootPids: readonly number[]): boolean {
  return rootPids.every((pid) => container.has(pid));
}

function selectProcessTrees(
  processTrees: ReadonlyMap<number, ProcessTreeResource>,
  rootPids: readonly number[]
): Map<number, ProcessTreeResource> {
  return new Map(
    rootPids.flatMap((rootPid) => {
      const resource = processTrees.get(rootPid);
      return resource ? ([[rootPid, resource]] as const) : [];
    })
  );
}

/**
 * Caches the expensive system-wide process inventory independently from the
 * lightweight Electron metrics snapshot. A hidden Agent panel can reuse the
 * last tree for minutes, while a visible panel can demand a sample only a few
 * seconds old. New root PIDs always force discovery immediately.
 */
export class AdaptiveProcessTreeSampler {
  private cached: ProcessTreeSampleCache | null = null;
  private inFlight: ProcessTreeSampleInFlight | null = null;
  private generation = 0;

  constructor(
    private readonly load: ProcessTreeSampleLoader = sampleProcessTrees,
    private readonly now: () => number = Date.now
  ) {}

  sample(rootPids: readonly number[], maxAgeMs: number): Promise<Map<number, ProcessTreeResource>> {
    if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
      return Promise.reject(
        new Error('Process sample max age must be a non-negative finite number.')
      );
    }
    const normalizedRootPids = normalizeRootPids(rootPids);
    if (normalizedRootPids.length === 0) return Promise.resolve(new Map());

    const cached = this.cached;
    if (
      cached &&
      this.now() - cached.sampledAt < maxAgeMs &&
      containsEveryPid(cached.rootPids, normalizedRootPids)
    ) {
      return Promise.resolve(selectProcessTrees(cached.value, normalizedRootPids));
    }

    const inFlight = this.inFlight;
    if (inFlight) {
      if (containsEveryPid(inFlight.rootPids, normalizedRootPids)) {
        return inFlight.promise.then((value) => selectProcessTrees(value, normalizedRootPids));
      }
      return inFlight.promise.then(
        () => this.sample(normalizedRootPids, maxAgeMs),
        () => this.sample(normalizedRootPids, maxAgeMs)
      );
    }

    const generation = this.generation;
    const roots = new Set(normalizedRootPids);
    const promise = Promise.resolve()
      .then(() => this.load(normalizedRootPids))
      .then((value) => {
        if (generation === this.generation) {
          this.cached = { rootPids: roots, value, sampledAt: this.now() };
        }
        return value;
      })
      .finally(() => {
        if (this.inFlight?.promise === promise) this.inFlight = null;
      });
    this.inFlight = { rootPids: roots, promise };
    return promise.then((value) => selectProcessTrees(value, normalizedRootPids));
  }

  clear(): void {
    this.generation += 1;
    this.cached = null;
    this.inFlight = null;
  }
}
