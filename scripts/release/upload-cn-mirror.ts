import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import * as qiniuModule from 'qiniu';
import { S3mini } from 's3mini';
import {
  findBlockmaps,
  findInstallers,
  findManifests,
  findSparkleDeltas,
  findSparkleFeeds,
} from './lib/artifacts.ts';
import { runWithConcurrency } from './lib/concurrency.ts';
import { requireEnv } from './lib/config.ts';
import { fail, info, step } from './lib/log.ts';

const QINIU_PART_SIZE_BYTES = 8 * 1024 * 1024;
const QINIU_OBJECT_TIMEOUT_MS = 30 * 60 * 1000;
const QINIU_CDN_REFRESH_TIMEOUT_MS = 2 * 60 * 1000;
const S3_OBJECT_TIMEOUT_MS = 10 * 60 * 1000;
const UPLOAD_CONCURRENCY = 3;
const qiniu = resolveQiniuSdk(qiniuModule);

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
const sparkleFeeds = findSparkleFeeds();
const sparkleDeltas = findSparkleDeltas();

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
const rootManifestUrls = manifests.map((manifest) => joinUrl(publicBaseUrl, basename(manifest)));
const version = inferVersionFromManifests(manifests);

const sparkleFeedUploads = sparkleFeeds.flatMap((feed) => {
  const name = basename(feed);
  return [
    {
      file: feed,
      key: joinKey(keyPrefix, name),
      contentType: contentTypeFor(name),
      label: `Sparkle feed ${name}`,
    },
    {
      file: feed,
      key: joinKey(keyPrefix, `v${version}`, name),
      contentType: contentTypeFor(name),
      label: `versioned Sparkle feed ${name}`,
    },
  ] satisfies UploadItem[];
});

const binaryUploads = [...installers, ...blockmaps].flatMap((file) => {
  const name = basename(file);
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
const latestAssetUrls = [...installers, ...blockmaps].map((file) =>
  joinUrl(publicBaseUrl, 'latest', basename(file))
);

const sparkleDeltaUploads = sparkleDeltas.flatMap((file) => {
  const name = basename(file);
  return [
    {
      file,
      key: joinKey(keyPrefix, `v${version}`, name),
      contentType: contentTypeFor(name),
      label: `versioned Sparkle delta ${name}`,
    },
    {
      file,
      key: joinKey(keyPrefix, 'latest', name),
      contentType: contentTypeFor(name),
      label: `latest Sparkle delta ${name}`,
    },
  ] satisfies UploadItem[];
});

const uploads = [
  ...manifestUploads,
  ...sparkleFeedUploads,
  ...binaryUploads,
  ...sparkleDeltaUploads,
];

step(`Uploading ${uploads.length} China mirror object(s)`);

if (dryRun) {
  for (const item of uploads) {
    info(`[dry-run] ${item.label} -> ${item.key}`);
  }
  process.exit(0);
}

await runWithConcurrency(uploads, UPLOAD_CONCURRENCY, async (item) => {
  const size = statSync(item.file).size;
  info(`Uploading ${item.label} (${formatMiB(size)} MB) -> ${item.key}`);
  const uploadTarget = createUploadTarget();
  await uploadTarget.upload(item, size);
});

if (isQiniuEndpoint(endpoint)) {
  await refreshQiniuCdnUrls([
    ...rootManifestUrls,
    ...sparkleFeeds.map((feed) => joinUrl(publicBaseUrl, basename(feed))),
    ...latestAssetUrls,
  ]);
}

info(`China mirror uploaded to ${publicBaseUrl}`);

type UploadTarget = {
  upload(item: UploadItem, size: number): Promise<void>;
};

function createUploadTarget(): UploadTarget {
  if (isQiniuEndpoint(endpoint)) {
    const bucket = process.env.YODA_CN_MIRROR_BUCKET?.trim() || bucketFromEndpoint(endpoint);
    if (!bucket) {
      fail(
        'YODA_CN_MIRROR_BUCKET is required when the Qiniu endpoint does not include a bucket path'
      );
    }

    info(`Using Qiniu resumable upload for bucket ${bucket}`);
    assertQiniuUploadApi();
    const mac = new qiniu.auth.digest.Mac(accessKeyId, secretAccessKey);
    const config = new qiniu.conf.Config({
      useHttpsDomain: true,
      ...(region === 'auto'
        ? {}
        : { regionsProvider: qiniu.httpc.Region.fromRegionId(qiniuRegionId(region)) }),
    });
    const uploader = new qiniu.resume_up.ResumeUploader(config);

    return {
      async upload(item, size) {
        const token = new qiniu.rs.PutPolicy({ scope: `${bucket}:${item.key}` }).uploadToken(mac);
        const progressCallback = createProgressLogger(item.label, size);
        const putExtra = qiniu.resume_up.PutExtra.create(
          basename(item.file),
          {},
          item.contentType,
          undefined,
          progressCallback,
          QINIU_PART_SIZE_BYTES,
          'v2'
        );

        const result = await withTimeout(
          uploader.putFileV2(token, item.key, item.file, putExtra),
          QINIU_OBJECT_TIMEOUT_MS,
          `Qiniu upload timed out for ${item.label}`
        );

        if (result.resp.statusCode !== 200) {
          fail(`Qiniu upload failed for ${item.label}: HTTP ${result.resp.statusCode}`);
        }
      },
    };
  }

  const s3 = new S3mini({
    accessKeyId,
    secretAccessKey,
    endpoint,
    region,
    requestAbortTimeout: S3_OBJECT_TIMEOUT_MS,
  });

  return {
    async upload(item, size) {
      const data = readFileSync(item.file);
      await s3.putObject(
        item.key,
        new Uint8Array(data),
        item.contentType,
        undefined,
        undefined,
        size
      );
    },
  };
}

type QiniuSdk = typeof qiniuModule;

function resolveQiniuSdk(module: QiniuSdk): QiniuSdk {
  return ((module as QiniuSdk & { default?: QiniuSdk }).default ?? module) as QiniuSdk;
}

function assertQiniuUploadApi(): void {
  if (
    !qiniu.auth?.digest?.Mac ||
    !qiniu.cdn?.CdnManager ||
    !qiniu.conf?.Config ||
    !qiniu.httpc?.Region?.fromRegionId ||
    !qiniu.resume_up?.ResumeUploader ||
    !qiniu.resume_up?.PutExtra?.create ||
    !qiniu.rs?.PutPolicy
  ) {
    fail('Qiniu SDK did not expose the expected resumable upload APIs');
  }
}

type QiniuCdnRefreshResult = {
  respBody: unknown;
  respInfo: { statusCode?: number } | undefined;
};

async function refreshQiniuCdnUrls(urls: string[]): Promise<void> {
  if (urls.length === 0) {
    return;
  }

  assertQiniuUploadApi();
  step(`Refreshing ${urls.length} China mirror CDN URL(s)`);

  const mac = new qiniu.auth.digest.Mac(accessKeyId, secretAccessKey);
  const cdnManager = new qiniu.cdn.CdnManager(mac);
  const result = await withTimeout(
    new Promise<QiniuCdnRefreshResult>((resolve, reject) => {
      cdnManager.refreshUrls(urls, (error, respBody, respInfo) => {
        if (error) {
          reject(error);
          return;
        }

        resolve({ respBody, respInfo });
      });
    }),
    QINIU_CDN_REFRESH_TIMEOUT_MS,
    'Qiniu CDN refresh timed out for published release URLs'
  );

  const statusCode = result.respInfo?.statusCode;
  if (typeof statusCode !== 'number' || statusCode >= 400) {
    fail(
      `Qiniu CDN refresh failed for published release URLs: HTTP ${statusCode ?? 'unknown'} ${JSON.stringify(result.respBody)}`
    );
  }

  info(`CDN refresh requested for ${urls.join(', ')}`);
}

function qiniuRegionId(value: string): string {
  const normalized = value.trim();
  const aliases: Record<string, string> = {
    'cn-east-1': 'z0',
    'cn-north-1': 'z1',
    'cn-south-1': 'z2',
    'us-north-1': 'na0',
    'ap-southeast-1': 'as0',
  };
  return aliases[normalized] || normalized;
}

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
  if (name.endsWith('.xml')) return 'application/rss+xml; charset=utf-8';
  if (name.endsWith('.dmg')) return 'application/x-apple-diskimage';
  if (name.endsWith('.zip')) return 'application/zip';
  if (name.endsWith('.exe')) return 'application/vnd.microsoft.portable-executable';
  if (name.endsWith('.msi')) return 'application/x-msi';
  if (name.endsWith('.deb')) return 'application/vnd.debian.binary-package';
  if (name.endsWith('.rpm')) return 'application/x-rpm';
  return 'application/octet-stream';
}

function createProgressLogger(
  label: string,
  totalBytes: number
): (uploadedBytes: number, totalBytes: number) => void {
  const thresholds = [25, 50, 75, 100];
  let nextThreshold = thresholds.shift();
  return (uploadedBytes, callbackTotalBytes) => {
    const total = callbackTotalBytes || totalBytes;
    if (!total || nextThreshold === undefined) {
      return;
    }
    const percent = Math.floor((uploadedBytes / total) * 100);
    while (nextThreshold !== undefined && percent >= nextThreshold) {
      info(`Upload progress ${label}: ${nextThreshold}%`);
      nextThreshold = thresholds.shift();
    }
  };
}

function formatMiB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function isQiniuEndpoint(value: string): boolean {
  try {
    const hostname = new URL(value).hostname;
    return hostname.includes('qiniucs.com') || hostname.includes('qiniu');
  } catch {
    return false;
  }
}

function bucketFromEndpoint(value: string): string {
  try {
    const url = new URL(value);
    return decodeURIComponent(url.pathname.replace(/^\/+|\/+$/g, '').split('/')[0] || '');
  } catch {
    return '';
  }
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
