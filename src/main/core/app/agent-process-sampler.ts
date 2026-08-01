import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type CachedSample<T> = {
  value: T;
  expiresAt: number;
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

  sample(load: () => Promise<T>): Promise<T> {
    const cached = this.cached;
    if (cached && this.now() < cached.expiresAt) return Promise.resolve(cached.value);
    if (this.inFlight) return this.inFlight;

    const generation = this.generation;
    const inFlight = Promise.resolve()
      .then(load)
      .then((value) => {
        if (generation === this.generation) {
          this.cached = { value, expiresAt: this.now() + this.ttlMs };
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
  const children = new Map<number, number[]>();
  for (const row of rows) {
    const list = children.get(row.parentPid) ?? [];
    list.push(row.pid);
    children.set(row.parentPid, list);
  }
  const included = new Set<number>();
  const pending = [rootPid];
  while (pending.length > 0) {
    const pid = pending.pop();
    if (pid === undefined || included.has(pid)) continue;
    included.add(pid);
    pending.push(...(children.get(pid) ?? []));
  }
  let representativePid = rootPid;
  let representativeMemory = -1;
  let cpuPercent = 0;
  let memoryBytes = 0;
  for (const row of rows) {
    if (!included.has(row.pid)) continue;
    cpuPercent += row.cpuPercent;
    memoryBytes += row.memoryBytes;
    if (row.memoryBytes > representativeMemory) {
      representativeMemory = row.memoryBytes;
      representativePid = row.pid;
    }
  }
  return {
    pid: representativePid,
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    memoryBytes,
  };
}

export async function sampleProcessTrees(
  rootPids: number[]
): Promise<Map<number, ProcessTreeResource>> {
  const uniquePids = [...new Set(rootPids.filter((pid) => Number.isSafeInteger(pid) && pid > 0))];
  if (uniquePids.length === 0 || process.platform === 'win32') return new Map();
  try {
    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,%cpu=,rss=']);
    const rows = parseProcessRows(stdout);
    return new Map(uniquePids.map((pid) => [pid, aggregateProcessTree(rows, pid)]));
  } catch {
    return new Map();
  }
}
