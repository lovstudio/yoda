import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as https from 'node:https';
import * as path from 'node:path';
import type {
  SkillCatalogSource,
  SkillDependency,
  SkillFileSnapshot,
  SkillFrontmatter,
  SkillHealthIssue,
  SkillRiskLevel,
} from '@shared/skills/types';

export const YODA_SKILL_MANIFEST = '.yoda-skill.json';

const MAX_REDIRECTS = 5;
const MAX_REMOTE_FILES = 512;
const MAX_REMOTE_BYTES = 25 * 1024 * 1024;
const MAX_INLINE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_INLINE_DIRECTORY_BYTES = 8 * 1024 * 1024;
const IGNORED_DIRS = new Set(['.git', 'node_modules']);
const SCRIPT_FILE_RE =
  /(?:^|\/)(?:scripts?|hooks?)\/|\.(?:sh|bash|zsh|fish|py|rb|pl|js|mjs|cjs|ts|ps1)$/i;
const NETWORK_RE = /https?:\/\/|\bcurl\b|\bwget\b|\bfetch\s*\(|\brequests\.(?:get|post)\b/i;
const HIGH_RISK_RE =
  /\bsudo\b|\brm\s+-rf\b|find-generic-password|process\.env\.[A-Z0-9_]*(?:TOKEN|KEY|SECRET)/i;

export interface ManagedSkillManifest {
  schemaVersion: 1;
  sourceKey: string;
  sourceUrl: string;
  installedAt: string;
  reviewedContentHash?: string;
}

export interface SkillDirectoryAudit {
  contentHash: string;
  files: SkillFileSnapshot[];
  fileCount: number;
  totalBytes: number;
  riskLevel: SkillRiskLevel;
  dependencies: SkillDependency[];
  healthIssues: SkillHealthIssue[];
}

export function makeSkillKey(source: SkillCatalogSource, id: string, locator: string): string {
  const normalized = source === 'local' ? path.resolve(locator) : locator.trim();
  const digest = createHash('sha256').update(`${source}\0${normalized}`).digest('hex').slice(0, 16);
  return `skill:${source}:${id}:${digest}`;
}

function isBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_192));
  return sample.includes(0);
}

async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function readFileSample(filePath: string): Promise<Buffer> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const sample = Buffer.alloc(8_192);
    const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
    return sample.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function assertSafeRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (
    !normalized ||
    normalized === '.' ||
    normalized.split('/').some((segment) => segment === '..') ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`Unsafe skill package path: ${relativePath}`);
  }
  return normalized;
}

async function walkSkillDirectory(root: string, current: string, output: string[]): Promise<void> {
  const entries = await fs.promises.readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.name === YODA_SKILL_MANIFEST) continue;
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (entry.isSymbolicLink()) {
      // A package hash must not escape through a symlink. The link itself is metadata.
      const target = await fs.promises.readlink(absolute);
      output.push(`${relative}\0link:${target}`);
      continue;
    }
    if (entry.isDirectory()) {
      await walkSkillDirectory(root, absolute, output);
      continue;
    }
    if (entry.isFile()) output.push(relative);
  }
}

export async function readSkillDirectoryFiles(root: string): Promise<SkillFileSnapshot[]> {
  const entries: string[] = [];
  await walkSkillDirectory(root, root, entries);
  const snapshots: SkillFileSnapshot[] = [];
  let inlineTextBytes = 0;
  for (const entry of entries) {
    const linkSeparator = entry.indexOf('\0link:');
    if (linkSeparator >= 0) {
      const relative = entry.slice(0, linkSeparator);
      const content = entry.slice(linkSeparator + 1);
      snapshots.push({
        path: relative,
        hash: createHash('sha256').update(content).digest('hex'),
        bytes: Buffer.byteLength(content),
        binary: false,
        content,
      });
      continue;
    }
    const absolute = path.join(root, entry);
    const stat = await fs.promises.stat(absolute);
    const shouldLimit =
      stat.size > MAX_INLINE_FILE_BYTES || inlineTextBytes + stat.size > MAX_INLINE_DIRECTORY_BYTES;
    if (shouldLimit) {
      const binary = isBinary(await readFileSample(absolute));
      snapshots.push({
        path: entry,
        hash: await hashFile(absolute),
        bytes: stat.size,
        binary,
        tooLarge: !binary,
      });
      continue;
    }
    const buffer = await fs.promises.readFile(absolute);
    const binary = isBinary(buffer);
    if (!binary) inlineTextBytes += buffer.length;
    snapshots.push({
      path: entry,
      hash: createHash('sha256').update(buffer).digest('hex'),
      bytes: buffer.length,
      binary,
      content: binary ? undefined : buffer.toString('utf8'),
    });
  }
  return snapshots;
}

function hashSnapshots(files: SkillFileSnapshot[]): string {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.path);
    hash.update('\0');
    hash.update(file.hash);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function parseOpenAiDependencies(files: SkillFileSnapshot[]): SkillDependency[] {
  const metadata = files.find((file) => file.path === 'agents/openai.yaml')?.content;
  if (!metadata) return [];
  const dependencies: SkillDependency[] = [];
  const blocks = metadata.split(/\n(?=\s*-\s+type:)/);
  for (const block of blocks) {
    const type = block.match(/(?:^|\n)\s*-?\s*type:\s*["']?([^\s"']+)/)?.[1];
    const value = block.match(/(?:^|\n)\s+value:\s*["']?([^\n"']+)/)?.[1]?.trim();
    if (!value) continue;
    const description = block.match(/(?:^|\n)\s+description:\s*["']?([^\n"']+)/)?.[1]?.trim();
    dependencies.push({
      type: type === 'mcp' ? 'mcp' : 'other',
      value,
      description,
    });
  }
  return dependencies;
}

export async function auditSkillDirectory(
  root: string,
  frontmatter?: SkillFrontmatter
): Promise<SkillDirectoryAudit> {
  const files = await readSkillDirectoryFiles(root);
  const totalBytes = files.reduce((total, file) => total + file.bytes, 0);
  const scripted = files.some((file) => SCRIPT_FILE_RE.test(file.path));
  const text = files
    .filter((file) => !file.binary)
    .map((file) => file.content ?? '')
    .join('\n');
  const networkAccess = NETWORK_RE.test(text);
  const highRisk = HIGH_RISK_RE.test(text);
  const privilegedTools = /(?:^|[\s,])(Bash|Write|Edit)(?:$|[\s,(])/i.test(
    frontmatter?.['allowed-tools'] ?? ''
  );
  const riskLevel: SkillRiskLevel = highRisk
    ? 'high'
    : scripted || networkAccess || privilegedTools
      ? 'elevated'
      : 'low';
  const healthIssues: SkillHealthIssue[] = [];
  if (scripted) {
    healthIssues.push({
      severity: 'info',
      code: 'scripted',
      message: 'This skill includes executable scripts or hooks. Review them before enabling it.',
    });
  }
  if (networkAccess) {
    healthIssues.push({
      severity: highRisk ? 'warning' : 'info',
      code: 'network-access',
      message: 'This skill contains network-access instructions or code.',
    });
  }
  if (files.some((file) => file.tooLarge)) {
    healthIssues.push({
      severity: 'warning',
      code: 'content-scan-limited',
      message: 'Some large text files were hashed but omitted from content and risk scanning.',
    });
  }
  return {
    contentHash: hashSnapshots(files),
    files,
    fileCount: files.length,
    totalBytes,
    riskLevel,
    dependencies: parseOpenAiDependencies(files),
    healthIssues,
  };
}

export async function readManagedSkillManifest(
  skillDir: string
): Promise<ManagedSkillManifest | null> {
  try {
    const raw = await fs.promises.readFile(path.join(skillDir, YODA_SKILL_MANIFEST), 'utf8');
    const parsed = JSON.parse(raw) as Partial<ManagedSkillManifest>;
    if (
      parsed.schemaVersion !== 1 ||
      typeof parsed.sourceKey !== 'string' ||
      typeof parsed.sourceUrl !== 'string' ||
      typeof parsed.installedAt !== 'string'
    ) {
      return null;
    }
    return parsed as ManagedSkillManifest;
  } catch {
    return null;
  }
}

export async function writeManagedSkillManifest(
  skillDir: string,
  manifest: ManagedSkillManifest
): Promise<void> {
  await fs.promises.writeFile(
    path.join(skillDir, YODA_SKILL_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
}

function httpsGetBuffer(
  url: string,
  redirectCount = 0,
  maxBytes = MAX_REMOTE_BYTES
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (redirectCount >= MAX_REDIRECTS) {
      reject(new Error(`Too many redirects (>${MAX_REDIRECTS}) for ${url}`));
      return;
    }
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'yoda-skills', Accept: 'application/vnd.github+json' } },
      (res) => {
        if (res.statusCode && [301, 302, 307, 308].includes(res.statusCode)) {
          const location = res.headers.location;
          if (!location) {
            reject(new Error(`Redirect without location for ${url}`));
            return;
          }
          res.resume();
          httpsGetBuffer(new URL(location, url).href, redirectCount + 1, maxBytes).then(
            resolve,
            reject
          );
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const chunks: Buffer[] = [];
        let received = 0;
        res.on('data', (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          received += buffer.length;
          if (received > maxBytes) {
            res.destroy(new Error(`Remote skill payload exceeds ${maxBytes} bytes`));
            return;
          }
          chunks.push(buffer);
        });
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.setTimeout(20_000, () => req.destroy(new Error('Request timed out')));
  });
}

interface GitHubTreeLocation {
  owner: string;
  repo: string;
  ref: string;
  directory: string;
}

export function parseGitHubTreeUrl(sourceUrl: string): GitHubTreeLocation | null {
  const match = sourceUrl.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+?)(?:[?#].*)?$/
  );
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/, ''),
    ref: match[3],
    directory: match[4].replace(/\/$/, ''),
  };
}

type GitHubContentsEntry = {
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  name: string;
  path: string;
  size?: number;
  download_url?: string | null;
};

async function listGitHubFiles(
  location: GitHubTreeLocation,
  directory: string,
  output: GitHubContentsEntry[]
): Promise<void> {
  const api = `https://api.github.com/repos/${location.owner}/${location.repo}/contents/${directory}?ref=${encodeURIComponent(location.ref)}`;
  const payload = JSON.parse((await httpsGetBuffer(api)).toString('utf8')) as
    | GitHubContentsEntry[]
    | GitHubContentsEntry;
  const entries = Array.isArray(payload) ? payload : [payload];
  for (const entry of entries) {
    if (entry.type === 'dir') {
      await listGitHubFiles(location, entry.path, output);
      continue;
    }
    if (entry.type !== 'file' || !entry.download_url) {
      throw new Error(`Unsupported GitHub skill package entry: ${entry.path} (${entry.type})`);
    }
    output.push(entry);
    if (output.length > MAX_REMOTE_FILES) {
      throw new Error(`Skill package exceeds ${MAX_REMOTE_FILES} files`);
    }
  }
}

export async function downloadGitHubSkillDirectory(
  sourceUrl: string,
  targetDir: string
): Promise<void> {
  const location = parseGitHubTreeUrl(sourceUrl);
  if (!location) throw new Error(`Unsupported skill source URL: ${sourceUrl}`);
  const entries: GitHubContentsEntry[] = [];
  await listGitHubFiles(location, location.directory, entries);
  let totalBytes = 0;
  for (const entry of entries) {
    const relative = assertSafeRelativePath(path.posix.relative(location.directory, entry.path));
    const buffer = await httpsGetBuffer(entry.download_url!, 0, MAX_REMOTE_BYTES - totalBytes);
    totalBytes += buffer.length;
    if (totalBytes > MAX_REMOTE_BYTES) {
      throw new Error(`Skill package exceeds ${Math.round(MAX_REMOTE_BYTES / 1024 / 1024)} MB`);
    }
    const destination = path.join(targetDir, ...relative.split('/'));
    if (!path.resolve(destination).startsWith(`${path.resolve(targetDir)}${path.sep}`)) {
      throw new Error(`Unsafe skill package path: ${relative}`);
    }
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.writeFile(destination, buffer);
  }
  await fs.promises.access(path.join(targetDir, 'SKILL.md'));
}
