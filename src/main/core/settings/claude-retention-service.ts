import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser';
import {
  CLAUDE_DEFAULT_CLEANUP_PERIOD_DAYS,
  type ClaudeRetentionSettings,
} from '@shared/claude-retention';

function settingsPath(homeDirectory: string): string {
  return join(homeDirectory, '.claude', 'settings.json');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSettings(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  const errors: ParseError[] = [];
  const value = parse(raw, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0 || !isPlainObject(value)) {
    throw new Error('Claude Code settings.json 不是有效的 JSON/JSONC 对象。');
  }
  return value;
}

async function readSettingsFile(configPath: string): Promise<string | null> {
  try {
    return await readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function getClaudeRetentionSettings(
  homeDirectory = homedir()
): Promise<ClaudeRetentionSettings> {
  const raw = await readSettingsFile(settingsPath(homeDirectory));
  const settings = parseSettings(raw ?? '{}');
  const cleanupPeriodDays = settings.cleanupPeriodDays;
  const configured = Number.isInteger(cleanupPeriodDays) && Number(cleanupPeriodDays) >= 1;
  return {
    cleanupPeriodDays: configured ? Number(cleanupPeriodDays) : null,
    effectiveCleanupPeriodDays: configured
      ? Number(cleanupPeriodDays)
      : CLAUDE_DEFAULT_CLEANUP_PERIOD_DAYS,
    configured,
  };
}

export async function updateClaudeRetentionSettings(
  cleanupPeriodDays: number,
  homeDirectory = homedir()
): Promise<ClaudeRetentionSettings> {
  if (!Number.isInteger(cleanupPeriodDays) || cleanupPeriodDays < 1) {
    throw new Error('cleanupPeriodDays 必须是大于或等于 1 的整数。');
  }

  const configPath = settingsPath(homeDirectory);
  const existing = await readSettingsFile(configPath);
  const raw = existing ?? '{}\n';
  parseSettings(raw);
  const next = applyEdits(
    raw,
    modify(raw, ['cleanupPeriodDays'], cleanupPeriodDays, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' },
    })
  );
  const content = next.endsWith('\n') ? next : `${next}\n`;

  await mkdir(dirname(configPath), { recursive: true });
  const temporaryPath = `${configPath}.${randomUUID()}.tmp`;
  const mode = await stat(configPath)
    .then((value) => value.mode)
    .catch(() => undefined);
  try {
    await writeFile(temporaryPath, content, { encoding: 'utf8', mode });
    await rename(temporaryPath, configPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }

  return {
    cleanupPeriodDays,
    effectiveCleanupPeriodDays: cleanupPeriodDays,
    configured: true,
  };
}
