import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type { RuntimeId } from '@shared/runtime-registry';
import type { IExecutionContext } from '@main/core/execution-context/types';
import {
  FileSystemError,
  FileSystemErrorCodes,
  type FileSystemProvider,
} from '@main/core/fs/types';
import { appSettingsService } from '@main/core/settings/settings-service';
import { resolveRemoteHome } from '@main/core/ssh/utils';
import { log } from '@main/lib/logger';

const CODEX_PROVIDER_ID: RuntimeId = 'codex';
const CODEX_CONFIG_NAME = 'config.toml';
const CODEX_CONFIG_MAX_BYTES = 2 * 1024 * 1024;

export class CodexTrustService {
  private readonly configLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly deps: {
      getTaskSettings: () => Promise<{ autoTrustWorktrees: boolean }>;
    }
  ) {}

  async maybeAutoTrustLocal({
    runtimeId,
    cwd,
    codexHome,
  }: {
    runtimeId: RuntimeId;
    cwd?: string;
    codexHome: string;
  }): Promise<void> {
    if (!cwd || !(await this.shouldAutoTrust(runtimeId))) return;

    const normalizedPath = path.resolve(cwd);
    const configPath = path.join(path.resolve(codexHome), CODEX_CONFIG_NAME);
    await this.withLock(configPath, () =>
      this.ensureTrusted(normalizedPath, {
        readConfig: () => readLocalConfig(configPath),
        writeConfig: (content) => writeLocalConfigAtomic(configPath, content),
      })
    );
  }

  async maybeAutoTrustSsh({
    runtimeId,
    cwd,
    codexHome,
    ctx,
    remoteFs,
  }: {
    runtimeId: RuntimeId;
    cwd?: string;
    codexHome?: string;
    ctx: IExecutionContext;
    remoteFs: Pick<FileSystemProvider, 'realPath' | 'read' | 'write'>;
  }): Promise<void> {
    if (!cwd || !(await this.shouldAutoTrust(runtimeId))) return;

    const normalizedPath = await remoteFs.realPath(cwd).catch(() => path.posix.resolve('/', cwd));
    const configuredCodexHome = codexHome?.trim();
    const stateDirectory =
      configuredCodexHome || path.posix.join(await resolveRemoteHome(ctx), '.codex');
    const configPath = path.posix.join(stateDirectory, CODEX_CONFIG_NAME);

    await this.withLock(configPath, () =>
      this.ensureTrusted(normalizedPath, {
        readConfig: () => readRemoteConfig(remoteFs, configPath),
        writeConfig: (content) => writeRemoteConfigAtomic(remoteFs, ctx, configPath, content),
      })
    );
  }

  private async shouldAutoTrust(runtimeId: RuntimeId): Promise<boolean> {
    if (runtimeId !== CODEX_PROVIDER_ID) return false;
    const { autoTrustWorktrees } = await this.deps.getTaskSettings();
    return autoTrustWorktrees;
  }

  private withLock(configPath: string, fn: () => Promise<void>): Promise<void> {
    const previous = this.configLocks.get(configPath) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    this.configLocks.set(configPath, next);
    return next;
  }

  private async ensureTrusted(
    normalizedPath: string,
    io: {
      readConfig: () => Promise<string | null>;
      writeConfig: (content: string) => Promise<void>;
    }
  ): Promise<void> {
    try {
      const rawConfig = await io.readConfig();
      const nextConfig = withTrustedProject(rawConfig, normalizedPath);
      if (!nextConfig) return;
      await io.writeConfig(nextConfig);
    } catch (error: unknown) {
      log.warn('CodexTrustService: failed to auto-trust project directory', {
        path: normalizedPath,
        error: String(error),
      });
    }
  }
}

export const codexTrustService = new CodexTrustService({
  getTaskSettings: () => appSettingsService.get('tasks'),
});

function withTrustedProject(rawConfig: string | null, projectPath: string): string | null {
  const content = rawConfig ?? '';
  const parsed = parseCodexConfig(content);
  if (!parsed) return null;

  const projects = asRecord(parsed.projects);
  const existing = asRecord(projects?.[projectPath]);
  if (existing?.trust_level === 'trusted') return null;

  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const tableIndex = lines.findIndex((line) => projectTablePath(line) === projectPath);

  if (tableIndex >= 0) {
    const tableEnd = findTableEnd(lines, tableIndex + 1);
    const assignmentIndex = lines
      .slice(tableIndex + 1, tableEnd)
      .findIndex((line) => /^\s*trust_level\s*=/.test(line));
    if (assignmentIndex >= 0) {
      const index = tableIndex + 1 + assignmentIndex;
      lines[index] = replaceTrustLevel(lines[index]);
    } else {
      lines.splice(tableIndex + 1, 0, 'trust_level = "trusted"');
    }
  } else {
    while (lines.at(-1)?.trim() === '') lines.pop();
    if (lines.length > 0) lines.push('');
    lines.push(`[projects.${JSON.stringify(projectPath)}]`, 'trust_level = "trusted"', '');
  }

  const nextConfig = lines.join(eol);
  validateTrustedProject(nextConfig, projectPath);
  return nextConfig;
}

function parseCodexConfig(content: string): Record<string, unknown> | null {
  if (!content.trim()) return {};
  try {
    return parseToml(content) as Record<string, unknown>;
  } catch (error: unknown) {
    log.warn('CodexTrustService: refusing to overwrite corrupt Codex config', {
      error: String(error),
    });
    return null;
  }
}

function projectTablePath(line: string): string | null {
  const match = line.match(/^\s*\[\s*projects\s*\.\s*("(?:\\.|[^"\\])*"|'[^']*')\s*\]\s*(?:#.*)?$/);
  if (!match) return null;
  const encoded = match[1];
  if (encoded.startsWith("'")) return encoded.slice(1, -1);
  try {
    return JSON.parse(encoded) as string;
  } catch {
    return null;
  }
}

function findTableEnd(lines: string[], startIndex: number): number {
  const relativeIndex = lines.slice(startIndex).findIndex((line) => /^\s*\[\[?/.test(line));
  return relativeIndex < 0 ? lines.length : startIndex + relativeIndex;
}

function replaceTrustLevel(line: string): string {
  const match = line.match(
    /^(\s*trust_level\s*=\s*)(?:"(?:\\.|[^"\\])*"|'[^']*'|[^#\s]+)(\s*(?:#.*)?)$/
  );
  if (!match) return 'trust_level = "trusted"';
  return `${match[1]}"trusted"${match[2]}`;
}

function validateTrustedProject(content: string, projectPath: string): void {
  const parsed = parseToml(content) as Record<string, unknown>;
  const projects = asRecord(parsed.projects);
  const project = asRecord(projects?.[projectPath]);
  if (project?.trust_level !== 'trusted') {
    throw new Error('Generated Codex project trust config is invalid.');
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function readLocalConfig(configPath: string): Promise<string | null> {
  try {
    return await fs.readFile(configPath, 'utf8');
  } catch (error: unknown) {
    if (isNodeNotFound(error)) return null;
    throw error;
  }
}

async function writeLocalConfigAtomic(configPath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const mode = await readLocalConfigMode(configPath);
  const temporaryPath = `${configPath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, content, { encoding: 'utf8', mode });
    await fs.rename(temporaryPath, configPath);
  } catch (error: unknown) {
    try {
      await fs.rm(temporaryPath, { force: true });
    } catch {}
    throw error;
  }
}

async function readLocalConfigMode(configPath: string): Promise<number> {
  try {
    return (await fs.stat(configPath)).mode & 0o777;
  } catch (error: unknown) {
    if (isNodeNotFound(error)) return 0o600;
    throw error;
  }
}

async function readRemoteConfig(
  remoteFs: Pick<FileSystemProvider, 'read'>,
  configPath: string
): Promise<string | null> {
  try {
    const result = await remoteFs.read(configPath, CODEX_CONFIG_MAX_BYTES);
    return result.content;
  } catch (error: unknown) {
    if (isFsNotFound(error)) return null;
    throw error;
  }
}

async function writeRemoteConfigAtomic(
  remoteFs: Pick<FileSystemProvider, 'write'>,
  ctx: IExecutionContext,
  configPath: string,
  content: string
): Promise<void> {
  const temporaryPath = `${configPath}.${randomUUID()}.tmp`;
  try {
    await ctx.exec('mkdir', ['-p', path.posix.dirname(configPath)]);
    await remoteFs.write(temporaryPath, content);
    await ctx.exec('chmod', ['600', temporaryPath]);
    await ctx.exec('mv', [temporaryPath, configPath]);
  } catch (error: unknown) {
    try {
      await ctx.exec('rm', ['-f', temporaryPath]);
    } catch {}
    throw error;
  }
}

function isNodeNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

function isFsNotFound(error: unknown): boolean {
  return error instanceof FileSystemError && error.code === FileSystemErrorCodes.NOT_FOUND;
}
