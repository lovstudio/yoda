import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { S3mini } from 's3mini';
import { findBlockmaps, findInstallers, findManifests } from './lib/artifacts.ts';
import { requireEnv } from './lib/config.ts';
import { fail, info, step } from './lib/log.ts';

const { values } = parseArgs({
  options: {
    channel: { type: 'string' },
    prefix: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
  strict: true,
});

type UploadItem = {
  file: string;
  key: string;
  contentType: string;
  label: string;
};

const endpoint = requireEnv('YODA_CN_MIRROR_ENDPOINT');
const accessKeyId = requireEnv('YODA_CN_MIRROR_ACCESS_KEY_ID');
const secretAccessKey = requireEnv('YODA_CN_MIRROR_SECRET_ACCESS_KEY');
const publicBaseUrl = trimTrailingSlash(requireEnv('YODA_CN_MIRROR_PUBLIC_BASE_URL'));
const region = process.env.YODA_CN_MIRROR_REGION || 'auto';
const keyPrefix =
  process.env.YODA_CN_MIRROR_KEY_PREFIX?.trim() || pathPrefixFromPublicBaseUrl(publicBaseUrl);
const dryRun = Boolean(values['dry-run']);

const manifests = findManifests(values.channel);
const installers = findInstallers(values.prefix);
const blockmaps = findBlockmaps();

if (manifests.length === 0) {
  fail('No update manifests found in release/');
}

if (installers.length === 0) {
  fail('No installers found in release/');
}

const mirrorManifestDir = join('release', '.cn-mirror');
const manifestUploads = manifests.flatMap((manifest) => {
  const mirrorManifest = writeMirrorManifest(manifest, publicBaseUrl, mirrorManifestDir);
  const version = readManifestVersion(mirrorManifest);
  const name = basename(mirrorManifest);
  return [
    {
      file: mirrorManifest,
      key: joinKey(keyPrefix, name),
      contentType: 'application/yaml; charset=utf-8',
      label: `manifest ${name}`,
    },
    {
      file: mirrorManifest,
      key: joinKey(keyPrefix, `v${version}`, name),
      contentType: 'application/yaml; charset=utf-8',
      label: `versioned manifest ${name}`,
    },
  ] satisfies UploadItem[];
});

const binaryUploads = [...installers, ...blockmaps].flatMap((file) => {
  const name = basename(file);
  const version = inferVersionFromManifests(manifests);
  return [
    {
      file,
      key: joinKey(keyPrefix, `v${version}`, name),
      contentType: contentTypeFor(name),
      label: `versioned asset ${name}`,
    },
    {
      file,
      key: joinKey(keyPrefix, 'latest', name),
      contentType: contentTypeFor(name),
      label: `latest asset ${name}`,
    },
  ] satisfies UploadItem[];
});

const uploads = [...manifestUploads, ...binaryUploads];

step(`Uploading ${uploads.length} China mirror object(s)`);

if (dryRun) {
  for (const item of uploads) {
    info(`[dry-run] ${item.label} -> ${item.key}`);
  }
  process.exit(0);
}

const s3 = new S3mini({
  accessKeyId,
  secretAccessKey,
  endpoint,
  region,
});

for (const item of uploads) {
  const data = readFileSync(item.file);
  info(`Uploading ${item.label} (${(data.length / 1024 / 1024).toFixed(1)} MB) -> ${item.key}`);
  await s3.putObject(item.key, new Uint8Array(data), item.contentType);
}

info(`China mirror uploaded to ${publicBaseUrl}`);

function writeMirrorManifest(manifest: string, baseUrl: string, outDir: string): string {
  const content = readFileSync(manifest, 'utf8');
  const version = parseVersion(content, manifest);
  const assetBase = joinUrl(baseUrl, `v${version}`);

  const rewritten = content.replace(
    /^(\s*(?:- )?(?:url|path):\s*)(\S+)$/gm,
    (_line, prefix: string, rawValue: string) =>
      `${prefix}${joinUrl(assetBase, fileNameFromUrl(rawValue))}`
  );

  mkdirSync(outDir, { recursive: true });
  const target = join(outDir, basename(manifest));
  writeFileSync(target, rewritten);
  return target;
}

function inferVersionFromManifests(paths: string[]): string {
  return readManifestVersion(paths[0]);
}

function readManifestVersion(path: string): string {
  return parseVersion(readFileSync(path, 'utf8'), path);
}

function parseVersion(content: string, source: string): string {
  const versionMatch = content.match(/^version:\s*(\S+)/m);
  if (!versionMatch) {
    fail(`No version field in ${source}`);
  }
  return versionMatch[1];
}

function fileNameFromUrl(rawValue: string): string {
  const value = rawValue.trim().replace(/^['"]|['"]$/g, '');
  try {
    const parsed = new URL(value);
    return basename(parsed.pathname);
  } catch {
    return basename(value);
  }
}

function contentTypeFor(name: string): string {
  if (name.endsWith('.yml')) return 'application/yaml; charset=utf-8';
  if (name.endsWith('.json')) return 'application/json; charset=utf-8';
  if (name.endsWith('.dmg')) return 'application/x-apple-diskimage';
  if (name.endsWith('.zip')) return 'application/zip';
  if (name.endsWith('.exe')) return 'application/vnd.microsoft.portable-executable';
  if (name.endsWith('.msi')) return 'application/x-msi';
  if (name.endsWith('.deb')) return 'application/vnd.debian.binary-package';
  if (name.endsWith('.rpm')) return 'application/x-rpm';
  return 'application/octet-stream';
}

function joinUrl(base: string, ...parts: string[]): string {
  const cleanBase = trimTrailingSlash(base);
  const cleanParts = parts.map((part) => part.replace(/^\/+|\/+$/g, '')).filter(Boolean);
  return [cleanBase, ...cleanParts].join('/');
}

function joinKey(...parts: string[]): string {
  return parts
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

function pathPrefixFromPublicBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.pathname.replace(/^\/+|\/+$/g, '');
  } catch {
    return '';
  }
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '');
}
