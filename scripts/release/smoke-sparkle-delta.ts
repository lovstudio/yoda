import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import {
  startSparkleFeedProxy,
  type SparkleFeedProxy,
} from '../../src/main/core/updates/sparkle-feed-proxy.ts';
import { findRequiredSparkleDelta } from '../../src/shared/sparkle-appcast.ts';
import { info, step } from './lib/log.ts';

if (process.platform !== 'darwin') {
  console.log('Not macOS — skipping Sparkle delta smoke test.');
  process.exit(0);
}

const generateAppcast = resolve('build/sparkle/bin/generate_appcast');
const helperSource = resolve('build/sparkle/YodaSparkleUpdater');
const frameworkSource = resolve('build/sparkle/Sparkle.framework');
for (const required of [generateAppcast, helperSource, frameworkSource]) {
  if (!existsSync(required)) throw new Error(`Missing Sparkle smoke-test dependency: ${required}`);
}

const root = mkdtempSync(join(tmpdir(), 'yoda-sparkle-delta-'));
let staticServer: ChildProcess | null = null;
let runningApp: ChildProcess | null = null;
let feedProxy: SparkleFeedProxy | null = null;
try {
  step('Creating signed Sparkle smoke-test applications');
  const keys = createSigningKeys();
  const bundleId = `ai.lovstudio.yoda.sparkle-smoke.${basename(root).replace(/[^a-z0-9]/gi, '')}`;
  const oldApp = createApp('1.0.0', 'old payload', keys.publicKey, bundleId, join(root, 'old'));
  const newApp = createApp('1.0.1', 'new payload', keys.publicKey, bundleId, join(root, 'new'));
  const archives = join(root, 'archives');
  mkdirSync(archives, { recursive: true });
  const oldArchive = join(archives, 'YodaSmoke-1.0.0.zip');
  const newArchive = join(archives, 'YodaSmoke-1.0.1.zip');
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', oldApp, oldArchive]);
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', newApp, newArchive]);
  const server = await startStaticServer(archives, root);
  staticServer = server.process;

  step('Generating and signing a real Sparkle delta');
  const appcastPath = join(archives, 'appcast.xml');
  run(
    generateAppcast,
    [
      '--ed-key-file',
      '-',
      '--disable-signing-warning',
      '--download-url-prefix',
      `${server.origin}/`,
      '--maximum-deltas',
      '1',
      '-o',
      appcastPath,
      archives,
    ],
    keys.privateKey
  );

  const appcast = readFileSync(appcastPath, 'utf8')
    .split(server.origin)
    .join('https://downloads.test');
  const delta = findRequiredSparkleDelta(appcast, '1.0.0');
  const deltaPath = join(archives, decodeURIComponent(basename(new URL(delta.url).pathname)));
  if (!existsSync(deltaPath)) throw new Error(`Generated delta is missing: ${deltaPath}`);
  feedProxy = await startSparkleFeedProxy(appcast, delta.url, {
    fetch: (input: string, init?: RequestInit) => {
      const upstreamUrl = new URL(input);
      return fetch(`${server.origin}${upstreamUrl.pathname}`, init);
    },
  } as never);

  // This is the decisive assertion: the complete 1.0.1 archive is physically
  // absent while Sparkle downloads, stages, and installs the update.
  rmSync(newArchive);

  step('Downloading and staging with the complete archive removed');
  runningApp = spawn('/usr/bin/open', ['-n', '-W', oldApp], {
    stdio: 'ignore',
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const staged = await runAsync(
    join(oldApp, 'Contents', 'Helpers', 'YodaSparkleUpdater'),
    helperArgs(oldApp, feedProxy.feedUrl, true)
  );
  assertEvent(staged, '"type":"update-found","version":"1.0.1","delta":true');
  assertEvent(staged, '"type":"ready-to-install"');
  if (staged.includes('full-update-blocked')) {
    throw new Error('Sparkle attempted a full update during the delta smoke test');
  }

  step('Installing the staged delta');
  runningApp.kill('SIGTERM');
  spawnSync('pkill', ['-f', join(oldApp, 'Contents', 'MacOS')]);
  runningApp = null;
  if (!(await waitForVersion(oldApp, '1.0.1', 2_000))) {
    const installed = await runAsync(
      join(oldApp, 'Contents', 'Helpers', 'YodaSparkleUpdater'),
      helperArgs(oldApp, feedProxy.feedUrl, false)
    );
    assertEvent(installed, '"type":"installing"');
  }

  if (!(await waitForVersion(oldApp, '1.0.1', 5_000))) {
    throw new Error('Sparkle did not install the staged delta');
  }
  const installedVersion = readVersion(oldApp);
  const installedPayload = readFileSync(
    join(oldApp, 'Contents', 'Resources', 'payload.txt'),
    'utf8'
  );
  if (installedVersion !== '1.0.1' || installedPayload !== 'new payload') {
    throw new Error(
      `Sparkle delta install mismatch: version=${installedVersion}, payload=${installedPayload}`
    );
  }

  info(
    `Sparkle delta-only smoke test passed (${formatMiB(delta.length)} MiB delta; full archive removed)`
  );
} finally {
  runningApp?.kill('SIGKILL');
  spawnSync('pkill', ['-f', join(root, 'old', 'Yoda Smoke.app', 'Contents', 'MacOS')]);
  await feedProxy?.close();
  staticServer?.kill('SIGTERM');
  if (process.env.YODA_KEEP_SPARKLE_SMOKE !== '1') {
    rmSync(root, { recursive: true, force: true });
  } else {
    info(`Kept Sparkle smoke-test files at ${root}`);
  }
}

function createApp(
  version: string,
  payload: string,
  publicKey: string,
  bundleId: string,
  parent: string
): string {
  const appPath = join(parent, 'Yoda Smoke.app');
  const contents = join(appPath, 'Contents');
  const macOS = join(contents, 'MacOS');
  const resources = join(contents, 'Resources');
  const frameworks = join(contents, 'Frameworks');
  const helpers = join(contents, 'Helpers');
  for (const directory of [macOS, resources, frameworks, helpers]) {
    mkdirSync(directory, { recursive: true });
  }

  const sourcePath = join(parent, 'main.c');
  writeFileSync(
    sourcePath,
    '#include <unistd.h>\nint main(void) { while (1) sleep(60); return 0; }\n'
  );
  run('clang', [sourcePath, '-o', join(macOS, 'Yoda Smoke')]);
  writeFileSync(join(resources, 'payload.txt'), payload);
  writeFileSync(join(contents, 'Info.plist'), infoPlist(version, publicKey, bundleId));
  copyFileSync(helperSource, join(helpers, 'YodaSparkleUpdater'));
  chmodSync(join(helpers, 'YodaSparkleUpdater'), 0o755);
  cpSync(frameworkSource, join(frameworks, 'Sparkle.framework'), {
    recursive: true,
    verbatimSymlinks: true,
  });
  run('codesign', ['--force', '--deep', '--sign', '-', appPath]);
  return appPath;
}

function infoPlist(version: string, publicKey: string, bundleId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleDisplayName</key><string>Yoda Smoke</string>
  <key>CFBundleExecutable</key><string>Yoda Smoke</string>
  <key>CFBundleIdentifier</key><string>${bundleId}</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>Yoda Smoke</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
  <key>SUPublicEDKey</key><string>${publicKey}</string>
</dict></plist>\n`;
}

function createSigningKeys(): { privateKey: string; publicKey: string } {
  const pair = generateKeyPairSync('ed25519');
  const privateJwk = pair.privateKey.export({ format: 'jwk' });
  const publicJwk = pair.publicKey.export({ format: 'jwk' });
  if (!privateJwk.d || !publicJwk.x) throw new Error('Failed to export temporary Ed25519 keys');
  return {
    privateKey: Buffer.from(privateJwk.d, 'base64url').toString('base64'),
    publicKey: Buffer.from(publicJwk.x, 'base64url').toString('base64'),
  };
}

function helperArgs(appPath: string, feedUrl: string, defer: boolean): string[] {
  return [
    appPath,
    '--application',
    appPath,
    '--feed-url',
    feedUrl,
    '--user-agent-name',
    'Yoda Sparkle Smoke',
    '--check-immediately',
    ...(defer ? ['--defer-install'] : []),
  ];
}

function run(command: string, args: string[], input?: string): string {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    input: input ? `${input}\n` : undefined,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 2 * 60 * 1000,
  });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim().slice(-12_000);
    throw new Error(
      `${basename(command)} failed (${result.status ?? result.signal ?? result.error?.message ?? 'unknown'}): ${output}`
    );
  }
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

async function runAsync(command: string, args: string[]): Promise<string> {
  return await new Promise<string>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(
      () => {
        child.kill('SIGKILL');
        rejectPromise(new Error(`${basename(command)} timed out`));
      },
      2 * 60 * 1000
    );

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      const output = `${stdout}\n${stderr}`;
      if (code === 0) {
        resolvePromise(output);
        return;
      }
      rejectPromise(
        new Error(
          `${basename(command)} failed (${code ?? signal ?? 'unknown'}): ${output.trim().slice(-12_000)}`
        )
      );
    });
  });
}

function assertEvent(output: string, marker: string): void {
  if (!output.includes(marker)) {
    throw new Error(`Sparkle event not observed: ${marker}\n${output.trim().slice(-4_000)}`);
  }
}

function formatMiB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2);
}

function readVersion(appPath: string): string {
  const result = spawnSync(
    '/usr/libexec/PlistBuddy',
    ['-c', 'Print :CFBundleVersion', join(appPath, 'Contents', 'Info.plist')],
    { encoding: 'utf8' }
  );
  return result.status === 0 ? result.stdout.trim() : '';
}

async function waitForVersion(
  appPath: string,
  expectedVersion: string,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (readVersion(appPath) === expectedVersion) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return readVersion(appPath) === expectedVersion;
}

async function startStaticServer(
  directory: string,
  tempRoot: string
): Promise<{ origin: string; process: ChildProcess }> {
  const port = await reservePort();
  const serverScript = join(tempRoot, 'static-server.mjs');
  writeFileSync(
    serverScript,
    `import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, join } from 'node:path';
const root = process.argv[2];
const port = Number(process.argv[3]);
createServer((request, response) => {
  try {
    const name = basename(decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname));
    const path = join(root, name);
    const stat = statSync(path);
    if (!stat.isFile()) throw new Error('not a file');
    response.writeHead(200, { 'Content-Length': stat.size, 'Cache-Control': 'no-store' });
    createReadStream(path).pipe(response);
  } catch {
    response.statusCode = 404;
    response.end();
  }
}).listen(port, '127.0.0.1');
`
  );
  const child = spawn(process.execPath, [serverScript, directory, String(port)], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await fetch(`${origin}/health`);
      return { origin, process: child };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  child.kill('SIGTERM');
  throw new Error('Sparkle smoke-test HTTP server did not start');
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to reserve a TCP port');
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}
