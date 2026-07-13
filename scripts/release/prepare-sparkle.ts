import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readlinkSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { info, step } from './lib/log.ts';

const SPARKLE_VERSION = '2.9.2';
const SPARKLE_COMMIT = '6276ba2b404829d139c45ff98427cf90e2efc59b';
const SPARKLE_ARCHIVE_SHA256 = '1cb340cbbef04c6c0d162078610c25e2221031d794a3449d89f2f56f4df77c95';
const SPARKLE_ARCHIVE_URL = `https://github.com/sparkle-project/Sparkle/releases/download/${SPARKLE_VERSION}/Sparkle-${SPARKLE_VERSION}.tar.xz`;

const stageDir = resolve('build/sparkle');
const cacheDir = resolve('.cache/sparkle');
const sourceDir = join(cacheDir, `Sparkle-${SPARKLE_VERSION}`);
const releaseArchivePath = join(cacheDir, `Sparkle-${SPARKLE_VERSION}.tar.xz`);
const releaseToolsDir = join(cacheDir, 'ReleaseTools');
const derivedDir = join(cacheDir, 'DerivedData');
const productsDir = join(cacheDir, 'Products');
const patchPath = resolve('native/macos/yoda-sparkle-updater/delta-only.patch');
const helperPath = join(stageDir, 'YodaSparkleUpdater');
const frameworkPath = join(stageDir, 'Sparkle.framework');
const generateAppcastPath = join(stageDir, 'bin', 'generate_appcast');

if (process.platform !== 'darwin') {
  info('Not macOS — skipping Sparkle helper preparation');
  process.exit(0);
}

if (isPrepared()) {
  info(`Sparkle ${SPARKLE_VERSION} helper is already prepared`);
  process.exit(0);
}

step(`Preparing Sparkle ${SPARKLE_VERSION} delta-only helper`);
mkdirSync(cacheDir, { recursive: true });
prepareSource();
applyDeltaOnlyPatch();
buildHelper();
prepareReleaseTools();
stageArtifacts();
verifyArtifacts();
info(`Prepared Sparkle helper in ${stageDir}`);

function isPrepared(): boolean {
  if (!existsSync(helperPath) || !existsSync(frameworkPath) || !existsSync(generateAppcastPath)) {
    return false;
  }
  const strings = run('strings', [helperPath], { capture: true });
  return (
    strings.includes('yoda-full-update-disabled') &&
    strings.includes('YODA_EVENT {"type":"installing"}') &&
    readFrameworkLink('Sparkle') === 'Versions/Current/Sparkle' &&
    readFrameworkLink(join('Versions', 'Current')) === 'B'
  );
}

function prepareSource(): void {
  rmSync(sourceDir, { recursive: true, force: true });
  run('git', [
    'clone',
    '--filter=blob:none',
    '--no-checkout',
    'https://github.com/sparkle-project/Sparkle.git',
    sourceDir,
  ]);
  run('git', ['-C', sourceDir, 'checkout', '--detach', SPARKLE_COMMIT]);
  const head = run('git', ['-C', sourceDir, 'rev-parse', 'HEAD'], { capture: true }).trim();
  if (head !== SPARKLE_COMMIT) {
    throw new Error(`Sparkle source identity mismatch: ${head}`);
  }
}

function applyDeltaOnlyPatch(): void {
  const patch = readFileSync(patchPath);
  run('git', ['-C', sourceDir, 'apply', '--check', patchPath]);
  run('git', ['-C', sourceDir, 'apply', patchPath]);
  const patchDigest = createHash('sha256').update(patch).digest('hex');
  info(`Applied delta-only patch ${patchDigest.slice(0, 12)}`);
}

function buildHelper(): void {
  rmSync(derivedDir, { recursive: true, force: true });
  rmSync(productsDir, { recursive: true, force: true });
  run(
    'xcodebuild',
    [
      '-project',
      join(sourceDir, 'Sparkle.xcodeproj'),
      '-scheme',
      'sparkle-cli',
      '-configuration',
      'Release',
      '-quiet',
      '-derivedDataPath',
      derivedDir,
      `CONFIGURATION_BUILD_DIR=${productsDir}`,
      'ARCHS=arm64 x86_64',
      'ONLY_ACTIVE_ARCH=NO',
      'CODE_SIGNING_ALLOWED=NO',
      'build',
    ],
    { capture: true }
  );
}

function prepareReleaseTools(): void {
  if (!existsSync(releaseArchivePath)) {
    run('curl', [
      '--fail',
      '--location',
      '--silent',
      '--show-error',
      '--output',
      releaseArchivePath,
      SPARKLE_ARCHIVE_URL,
    ]);
  }

  const archiveDigest = createHash('sha256').update(readFileSync(releaseArchivePath)).digest('hex');
  if (archiveDigest !== SPARKLE_ARCHIVE_SHA256) {
    rmSync(releaseArchivePath, { force: true });
    throw new Error(`Sparkle release archive checksum mismatch: ${archiveDigest}`);
  }

  rmSync(releaseToolsDir, { recursive: true, force: true });
  mkdirSync(releaseToolsDir, { recursive: true });
  run('tar', ['-xJf', releaseArchivePath, '-C', releaseToolsDir]);
}

function stageArtifacts(): void {
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });
  cpSync(join(productsDir, 'sparkle.app', 'Contents', 'MacOS', 'sparkle'), helperPath);
  cpSync(join(productsDir, 'Sparkle.framework'), frameworkPath, {
    recursive: true,
    verbatimSymlinks: true,
  });
  cpSync(join(releaseToolsDir, 'bin'), join(stageDir, 'bin'), {
    recursive: true,
    verbatimSymlinks: true,
  });
}

function verifyArtifacts(): void {
  const architectures = run('lipo', ['-archs', helperPath], { capture: true });
  if (!architectures.includes('arm64') || !architectures.includes('x86_64')) {
    throw new Error(`Sparkle helper is not universal: ${architectures.trim()}`);
  }
  const strings = run('strings', [helperPath], { capture: true });
  if (!strings.includes('yoda-full-update-disabled')) {
    throw new Error('Sparkle helper does not contain the delta-only guard');
  }
  if (!strings.includes('YODA_EVENT {"type":"installing"}')) {
    throw new Error('Sparkle helper does not contain the install handoff marker');
  }
  const linked = run('otool', ['-L', helperPath], { capture: true });
  if (!linked.includes('@rpath/Sparkle.framework')) {
    throw new Error('Sparkle helper is not linked against Sparkle.framework');
  }
  if (
    readFrameworkLink('Sparkle') !== 'Versions/Current/Sparkle' ||
    readFrameworkLink(join('Versions', 'Current')) !== 'B'
  ) {
    throw new Error('Sparkle.framework contains non-portable symbolic links');
  }
  const toolArchitectures = run('lipo', ['-archs', generateAppcastPath], { capture: true });
  if (!toolArchitectures.includes('arm64') || !toolArchitectures.includes('x86_64')) {
    throw new Error(`Sparkle generate_appcast is not universal: ${toolArchitectures.trim()}`);
  }
}

function readFrameworkLink(relativePath: string): string | null {
  try {
    return readlinkSync(join(frameworkPath, relativePath));
  } catch {
    return null;
  }
}

type RunOptions = { capture?: boolean };

function run(command: string, args: string[], options: RunOptions = {}): string {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.status !== 0) {
    const details = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim().slice(-12_000);
    const reason = result.error?.message ?? result.signal ?? `exit code ${result.status}`;
    throw new Error(`${command} failed with ${reason}${details ? `:\n${details}` : ''}`);
  }
  return result.stdout ?? '';
}

// Kept as a pinned supply-chain assertion for release tooling that downloads
// the official distribution archive for generate_appcast and signing tools.
export const sparkleSupplyChainPin = {
  version: SPARKLE_VERSION,
  commit: SPARKLE_COMMIT,
  archiveUrl: SPARKLE_ARCHIVE_URL,
  archiveSha256: SPARKLE_ARCHIVE_SHA256,
};
