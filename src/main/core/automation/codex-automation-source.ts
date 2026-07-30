import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { z } from 'zod';
import type { AutomationStatus, AutomationTriggerKind } from '@shared/automation';

export const CODEX_AUTOMATION_ID_PREFIX = 'codex:';

const codexAutomationSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    prompt: z.string().min(1),
    status: z.enum(['ACTIVE', 'PAUSED', 'DELETED']),
    sync_to_yoda: z.boolean().optional(),
    rrule: z.string().trim().min(1).optional(),
    timezone: z.string().trim().min(1).optional(),
    cwds: z.array(z.string()).optional(),
    created_at: z.number().finite().optional(),
    updated_at: z.number().finite().optional(),
  })
  .passthrough();

type CodexAutomationFile = z.infer<typeof codexAutomationSchema>;

export type CodexAutomationSnapshot = {
  id: string;
  sourceId: string;
  title: string;
  workspaceName: string;
  prompt: string;
  status: AutomationStatus;
  triggerKind: AutomationTriggerKind;
  cronExpr: string | null;
  timezone: string | null;
  scheduleLabel: string;
  createdAt: string;
  updatedAt: string;
};

export type CodexAutomationReadError = {
  path: string;
  message: string;
};

export type CodexAutomationReadResult = {
  available: boolean;
  automations: CodexAutomationSnapshot[];
  /** IDs retained during reconciliation, including files that failed to parse. */
  managedIds: string[];
  errors: CodexAutomationReadError[];
};

function parseRrule(rrule: string): Map<string, string> {
  const parts = new Map<string, string>();
  for (const clause of rrule.split(';')) {
    const separator = clause.indexOf('=');
    if (separator <= 0 || separator === clause.length - 1) {
      throw new Error(`Invalid RRULE clause: ${clause}`);
    }
    parts.set(
      clause.slice(0, separator).trim().toUpperCase(),
      clause
        .slice(separator + 1)
        .trim()
        .toUpperCase()
    );
  }
  return parts;
}

function integerPart(
  parts: Map<string, string>,
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = parts.get(key);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`RRULE ${key} must be an integer`);
  const value = Number(raw);
  if (value < min || value > max) {
    throw new Error(`RRULE ${key} must be between ${min} and ${max}`);
  }
  return value;
}

function integerList(
  parts: Map<string, string>,
  key: string,
  fallback: number,
  min: number,
  max: number
): string {
  const raw = parts.get(key);
  if (raw === undefined) return String(fallback);
  const values = raw.split(',').map((value) => {
    if (!/^\d+$/.test(value)) throw new Error(`RRULE ${key} must contain integers`);
    const parsed = Number(value);
    if (parsed < min || parsed > max) {
      throw new Error(`RRULE ${key} values must be between ${min} and ${max}`);
    }
    return parsed;
  });
  return [...new Set(values)].join(',');
}

/**
 * Converts the recurring patterns emitted by Codex Automations into Yoda's
 * five-field Cron format. Patterns that cannot be represented faithfully are
 * rejected instead of being scheduled at the wrong time.
 */
export function codexRruleToCron(rrule: string): string {
  const parts = parseRrule(rrule);
  const supported = new Set([
    'FREQ',
    'INTERVAL',
    'BYHOUR',
    'BYMINUTE',
    'BYSECOND',
    'BYDAY',
    'BYMONTHDAY',
    'WKST',
  ]);
  for (const key of parts.keys()) {
    if (!supported.has(key)) throw new Error(`Unsupported RRULE field: ${key}`);
  }

  const seconds = integerPart(parts, 'BYSECOND', 0, 0, 59);
  if (seconds !== 0) {
    throw new Error('Yoda automations run at minute precision; BYSECOND must be 0');
  }

  const frequency = parts.get('FREQ');
  const interval = integerPart(parts, 'INTERVAL', 1, 1, 24);
  const minute = integerList(parts, 'BYMINUTE', 0, 0, 59);
  const hour = integerList(parts, 'BYHOUR', 0, 0, 23);

  if (frequency === 'HOURLY') {
    if (parts.has('BYHOUR')) throw new Error('HOURLY does not support BYHOUR');
    if (24 % interval !== 0) {
      throw new Error('HOURLY interval must divide evenly into 24 hours');
    }
    return `${minute} ${interval === 1 ? '*' : `*/${interval}`} * * *`;
  }

  if (interval !== 1) {
    throw new Error(`${frequency ?? 'Unknown'} intervals above 1 are not Cron-equivalent`);
  }

  if (frequency === 'DAILY') {
    return `${minute} ${hour} * * *`;
  }

  if (frequency === 'WEEKLY') {
    const rawDays = parts.get('BYDAY');
    if (!rawDays) throw new Error('WEEKLY requires BYDAY');
    const dayNumbers: Record<string, number> = {
      SU: 0,
      MO: 1,
      TU: 2,
      WE: 3,
      TH: 4,
      FR: 5,
      SA: 6,
    };
    const days = rawDays.split(',').map((day) => {
      const value = dayNumbers[day];
      if (value === undefined) throw new Error(`Unsupported weekly day: ${day}`);
      return value;
    });
    return `${minute} ${hour} * * ${[...new Set(days)].join(',')}`;
  }

  if (frequency === 'MONTHLY') {
    if (!parts.has('BYMONTHDAY')) throw new Error('MONTHLY requires BYMONTHDAY');
    const day = integerList(parts, 'BYMONTHDAY', 1, 1, 31);
    return `${minute} ${hour} ${day} * *`;
  }

  throw new Error(`Unsupported RRULE frequency: ${frequency ?? 'missing'}`);
}

function timestampToIso(value: number | undefined, fallback: Date): string {
  if (value === undefined) return fallback.toISOString();
  const milliseconds = value < 100_000_000_000 ? value * 1000 : value;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
}

function workspaceName(file: CodexAutomationFile): string {
  const cwd = file.cwds?.find((candidate) => candidate.trim().length > 0);
  return (cwd ? basename(cwd) : '') || 'Codex';
}

export function parseCodexAutomationToml(
  input: string,
  options: { fallbackTimestamp?: Date } = {}
): CodexAutomationSnapshot | null {
  const file = codexAutomationSchema.parse(parseToml(input));
  if (file.status === 'DELETED' || file.sync_to_yoda !== true) return null;

  const fallbackTimestamp = options.fallbackTimestamp ?? new Date();
  const cronExpr = file.rrule ? codexRruleToCron(file.rrule) : null;
  return {
    id: `${CODEX_AUTOMATION_ID_PREFIX}${file.id}`,
    sourceId: file.id,
    title: file.name,
    workspaceName: workspaceName(file),
    prompt: file.prompt,
    status: file.status === 'PAUSED' ? 'paused' : 'active',
    triggerKind: cronExpr ? 'cron' : 'manual',
    cronExpr,
    timezone: file.timezone ?? null,
    scheduleLabel: file.rrule ?? '',
    createdAt: timestampToIso(file.created_at, fallbackTimestamp),
    updatedAt: timestampToIso(file.updated_at, fallbackTimestamp),
  };
}

export function resolveCodexAutomationsRoot(): string {
  const codexHome = process.env.CODEX_HOME?.trim() || join(homedir(), '.codex');
  return join(codexHome, 'automations');
}

export async function readCodexAutomationSnapshots(
  root: string = resolveCodexAutomationsRoot()
): Promise<CodexAutomationReadResult> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : '';
    if (code === 'ENOENT') {
      return { available: false, automations: [], managedIds: [], errors: [] };
    }
    return {
      available: false,
      automations: [],
      managedIds: [],
      errors: [{ path: root, message: error instanceof Error ? error.message : String(error) }],
    };
  }

  const automations: CodexAutomationSnapshot[] = [];
  const managedIds = new Set<string>();
  const errors: CodexAutomationReadError[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue;
    const filePath = join(root, entry.name, 'automation.toml');
    try {
      const [input, fileStat] = await Promise.all([readFile(filePath, 'utf8'), stat(filePath)]);
      const snapshot = parseCodexAutomationToml(input, { fallbackTimestamp: fileStat.mtime });
      if (!snapshot) continue;
      managedIds.add(snapshot.id);
      automations.push(snapshot);
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : '';
      if (code === 'ENOENT') continue;
      managedIds.add(`${CODEX_AUTOMATION_ID_PREFIX}${entry.name}`);
      errors.push({
        path: filePath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  automations.sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.sourceId.localeCompare(right.sourceId)
  );
  return {
    available: true,
    automations,
    managedIds: [...managedIds],
    errors,
  };
}
