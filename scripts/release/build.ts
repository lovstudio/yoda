import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { exec } from './lib/exec.ts';
import { fail, info, step, warn } from './lib/log.ts';

type UpdateFile = {
  url: string;
  sha512: string;
  size?: number;
  blockMapSize?: number;
};

type UpdateManifest = {
  version: string;
  files: UpdateFile[];
  path?: string;
  sha512?: string;
  releaseDate?: string;
};

const { values } = parseArgs({
  options: {
    platform: { type: 'string' },
    arch: { type: 'string', default: 'both' },
    targets: { type: 'string' },
    config: { type: 'string', default: 'electron-builder.config.ts' },
  },
  strict: true,
});

const platform = values.platform;
if (!platform || !['mac', 'linux', 'win'].includes(platform)) {
  fail(
    'Usage: build.ts --platform mac|linux|win [--arch arm64|x64|both] [--targets dmg,zip] [--config electron-builder.config.ts]'
  );
}

const archInput = values.arch ?? 'both';
const archs: string[] = archInput === 'both' ? ['x64', 'arm64'] : [archInput];
const manifests: UpdateManifest[] = [];

const defaultTargets: Record<string, string> = {
  mac: 'dmg zip',
  linux: 'AppImage deb rpm',
  win: 'nsis msi',
};
const targets = values.targets ? values.targets.split(',').join(' ') : defaultTargets[platform];

for (const arch of archs) {
  step(`Building ${platform} ${targets} for ${arch}`);

  exec(`node --experimental-strip-types scripts/release/rebuild-native.ts --arch ${arch}`, {
    echo: true,
  });

  const platformFlag = `--${platform}`;
  const archFlag = `--${arch}`;
  const cmd = [
    'pnpm exec electron-builder',
    platformFlag,
    targets,
    archFlag,
    '--publish always',
    `--config ${values.config}`,
    '--config.npmRebuild=false',
  ].join(' ');

  exec(cmd, { echo: true });
  if (archs.length > 1) {
    collectManifest(platform, manifests);
  }
  info(`Built ${platform} ${targets} for ${arch}`);
}

if (archs.length > 1) {
  writeMergedManifest(platform, manifests);
}

function collectManifest(platform: string, manifests: UpdateManifest[]): void {
  const manifestPath = getManifestPath(platform);
  if (!manifestPath || !existsSync(manifestPath)) return;
  manifests.push(parseManifest(readFileSync(manifestPath, 'utf8')));
}

function writeMergedManifest(platform: string, manifests: UpdateManifest[]): void {
  if (manifests.length <= 1) return;

  const manifestPath = getManifestPath(platform);
  if (!manifestPath) return;

  const [first] = manifests;
  const files = dedupeFiles(manifests.flatMap((manifest) => manifest.files));
  const primary = files.find((file) => file.url === first.path) ?? files[0];
  if (!primary) {
    warn(`No update files found while merging ${basename(manifestPath)}`);
    return;
  }

  const merged: UpdateManifest = {
    version: first.version,
    files,
    path: primary.url,
    sha512: primary.sha512,
    releaseDate: manifests.at(-1)?.releaseDate ?? first.releaseDate,
  };

  writeFileSync(manifestPath, formatManifest(merged));
  info(`Merged ${manifests.length} update manifests into ${basename(manifestPath)}`);
}

function getManifestPath(platform: string): string | null {
  const candidates = platform === 'win' ? [/^.*\.yml$/] : [new RegExp(`^.*-${platform}.*\\.yml$`)];
  const names = readdirSync('release').filter(
    (name) => !name.startsWith('builder-') && candidates.some((candidate) => candidate.test(name))
  );
  if (names.length === 0) return null;
  return join('release', names.sort()[0]);
}

function dedupeFiles(files: UpdateFile[]): UpdateFile[] {
  const seen = new Set<string>();
  const deduped: UpdateFile[] = [];
  for (const file of files) {
    if (seen.has(file.url)) continue;
    seen.add(file.url);
    deduped.push(file);
  }
  return deduped;
}

function parseManifest(content: string): UpdateManifest {
  const manifest: UpdateManifest = { version: '', files: [] };
  let currentFile: UpdateFile | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim() || line.trim() === 'files:') continue;

    const fileMatch = /^-\s+url:\s+(.+)$/.exec(line.trim());
    if (fileMatch) {
      currentFile = { url: parseScalar(fileMatch[1]), sha512: '' };
      manifest.files.push(currentFile);
      continue;
    }

    const fileFieldMatch = /^([A-Za-z0-9]+):\s+(.+)$/.exec(line.trim());
    if (!fileFieldMatch) continue;

    const [, key, rawValue] = fileFieldMatch;
    const value = parseScalar(rawValue);
    if (currentFile && rawLine.startsWith('    ')) {
      setFileValue(currentFile, key, value);
    } else {
      setManifestValue(manifest, key, value);
      currentFile = null;
    }
  }

  if (!manifest.version) {
    fail('Could not parse update manifest version');
  }

  return manifest;
}

function parseScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function setManifestValue(manifest: UpdateManifest, key: string, value: string): void {
  if (key === 'version') manifest.version = value;
  if (key === 'path') manifest.path = value;
  if (key === 'sha512') manifest.sha512 = value;
  if (key === 'releaseDate') manifest.releaseDate = value;
}

function setFileValue(file: UpdateFile, key: string, value: string): void {
  if (key === 'url') file.url = value;
  if (key === 'sha512') file.sha512 = value;
  if (key === 'size') file.size = Number(value);
  if (key === 'blockMapSize') file.blockMapSize = Number(value);
}

function formatManifest(manifest: UpdateManifest): string {
  const lines = [`version: ${manifest.version}`, 'files:'];
  for (const file of manifest.files) {
    lines.push(`  - url: ${file.url}`);
    lines.push(`    sha512: ${file.sha512}`);
    if (typeof file.size === 'number' && Number.isFinite(file.size)) {
      lines.push(`    size: ${file.size}`);
    }
    if (typeof file.blockMapSize === 'number' && Number.isFinite(file.blockMapSize)) {
      lines.push(`    blockMapSize: ${file.blockMapSize}`);
    }
  }
  if (manifest.path) lines.push(`path: ${manifest.path}`);
  if (manifest.sha512) lines.push(`sha512: ${manifest.sha512}`);
  if (manifest.releaseDate) lines.push(`releaseDate: '${manifest.releaseDate}'`);
  return `${lines.join('\n')}\n`;
}
