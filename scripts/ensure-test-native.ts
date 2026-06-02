/**
 * Ensures a Node-ABI build of better-sqlite3 exists for vitest.
 *
 * postinstall rebuilds better-sqlite3 against Electron's V8 ABI (e.g. 145 for
 * Electron 41), but vitest runs in plain Node (ABI 137). Tests that
 * `new Database()` directly fail with NODE_MODULE_VERSION mismatch.
 *
 * This script keeps a Node-ABI copy at a known cache path so vitest can load
 * it via the `nativeBinding` option, without disturbing the Electron build.
 *
 * Lookup order:
 *   1. Cache hit at the expected path → done
 *   2. ~/.npm/_prebuilds/<hash>-better-sqlite3-v<ver>-node-v<abi>-<plat>-<arch>.tar.gz → extract
 *   3. Download from GitHub releases → extract
 *
 * Prints the absolute path of the .node file on success.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type Spec = {
  version: string;
  abi: string;
  platform: string;
  arch: string;
};

function getSpec(): Spec {
  const pkgPath = path.resolve('node_modules/better-sqlite3/package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version: string };
  return {
    version: pkg.version,
    abi: process.versions.modules,
    platform: process.platform,
    arch: process.arch,
  };
}

function tarballName({ version, abi, platform, arch }: Spec): string {
  return `better-sqlite3-v${version}-node-v${abi}-${platform}-${arch}.tar.gz`;
}

/**
 * Deterministic — used by both ensure-test-native and the vitest shim.
 */
export function testNativeBindingPath(): string {
  const spec = getSpec();
  return path.resolve(
    'node_modules/.cache/yoda-test-native',
    `better-sqlite3-v${spec.version}-node-v${spec.abi}-${spec.platform}-${spec.arch}`,
    'build/Release/better_sqlite3.node'
  );
}

async function findNpmPrebuild(spec: Spec): Promise<string | null> {
  const prebuildsDir = path.join(homedir(), '.npm', '_prebuilds');
  let entries: string[];
  try {
    entries = await fs.promises.readdir(prebuildsDir);
  } catch {
    return null;
  }

  const wanted = tarballName(spec);
  // npm cache files use `<hash>-<tarball>` format
  const hit = entries.find((e) => e.endsWith(wanted));
  return hit ? path.join(prebuildsDir, hit) : null;
}

function downloadUrl(spec: Spec): string {
  return `https://github.com/WiseLibs/better-sqlite3/releases/download/v${spec.version}/${tarballName(spec)}`;
}

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tmp = `${dest}.${process.pid}.tmp`;
    const file = fs.createWriteStream(tmp);
    const req = https.get(url, { headers: { 'User-Agent': 'yoda-test-native' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const location = res.headers.location;
        if (location) {
          file.close();
          fs.promises.unlink(tmp).catch(() => undefined);
          return download(location, dest).then(resolve, reject);
        }
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.promises.unlink(tmp).catch(() => undefined);
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on('finish', () =>
        file.close(() => fs.promises.rename(tmp, dest).then(() => resolve(), reject))
      );
    });
    req.on('error', (err) => {
      file.close();
      fs.promises.unlink(tmp).catch(() => undefined);
      reject(err);
    });
    req.setTimeout(60000, () => req.destroy(new Error('Download timed out')));
  });
}

async function extract(tarball: string, intoDir: string): Promise<void> {
  await fs.promises.mkdir(intoDir, { recursive: true });
  await execFileAsync('tar', ['-xzf', tarball, '-C', intoDir]);
}

export async function ensureTestNative(): Promise<string> {
  const spec = getSpec();
  const targetPath = testNativeBindingPath();
  // <cache>/<spec-dir>/build/Release/better_sqlite3.node → <cache>/<spec-dir>
  const targetDir = path.dirname(path.dirname(path.dirname(targetPath)));

  if (fs.existsSync(targetPath)) return targetPath;

  await fs.promises.mkdir(targetDir, { recursive: true });

  // 1. Try local npm prebuild cache
  const localTarball = await findNpmPrebuild(spec);
  if (localTarball) {
    await extract(localTarball, targetDir);
    if (fs.existsSync(targetPath)) return targetPath;
  }

  // 2. Download from GitHub
  const dlTarball = path.join(
    tmpdir(),
    `yoda-test-native-${createHash('sha1').update(targetDir).digest('hex').slice(0, 8)}-${tarballName(spec)}`
  );
  await download(downloadUrl(spec), dlTarball);
  try {
    await extract(dlTarball, targetDir);
  } finally {
    await fs.promises.unlink(dlTarball).catch(() => undefined);
  }

  if (!fs.existsSync(targetPath)) {
    throw new Error(
      `ensure-test-native: extracted tarball but no .node at ${targetPath}. ` +
        `Inspect ${targetDir}.`
    );
  }
  return targetPath;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  ensureTestNative().then(
    (p) => {
      process.stdout.write(`${p}\n`);
    },
    (err: Error) => {
      console.error('ensure-test-native failed:', err.message);
      process.exit(1);
    }
  );
}
