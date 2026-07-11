import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { info, step } from './lib/log.ts';

const SPARKLE_VERSION = '2.9.2';
const SPARKLE_COMMIT = '6276ba2b404829d139c45ff98427cf90e2efc59b';
const SPARKLE_ARCHIVE_SHA256 = '1cb340cbbef04c6c0d162078610c25e2221031d794a3449d89f2f56f4df77c95';
const SPARKLE_ARCHIVE_URL = `https://github.com/sparkle-project/Sparkle/releases/download/${SPARKLE_VERSION}/Sparkle-${SPARKLE_VERSION}.tar.xz`;

const stageDir = resolve('build/sparkle');
const cacheDir = resolve('.cache/sparkle');
const sourceDir = join(cacheDir, `Sparkle-${SPARKLE_VERSION}`);
const derivedDir = join(cacheDir, 'DerivedData');
const productsDir = join(cacheDir, 'Products');
const patchPath = resolve('native/macos/yoda-sparkle-updater/delta-only.patch');
const helperPath = join(stageDir, 'YodaSparkleUpdater');
const frameworkPath = join(stageDir, 'Sparkle.framework');

if (process.platform !== 'darwin') {
  throw new Error('Sparkle helper can only be prepared on macOS');
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
stageArtifacts();
verifyArtifacts();
info(`Prepared Sparkle helper in ${stageDir}`);

function isPrepared(): boolean {
  if (!existsSync(helperPath) || !existsSync(frameworkPath)) return false;
  const strings = run('strings', [helperPath], { capture: true });
  return strings.includes('yoda-full-update-disabled');
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
  run('xcodebuild', [
    '-project',
    join(sourceDir, 'Sparkle.xcodeproj'),
    '-scheme',
    'sparkle-cli',
    '-configuration',
    'Release',
    '-derivedDataPath',
    derivedDir,
    `CONFIGURATION_BUILD_DIR=${productsDir}`,
    'ARCHS=arm64 x86_64',
    'ONLY_ACTIVE_ARCH=NO',
    'CODE_SIGNING_ALLOWED=NO',
    'build',
  ]);
}

function stageArtifacts(): void {
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });
  cpSync(join(productsDir, 'sparkle.app', 'Contents', 'MacOS', 'sparkle'), helperPath);
  cpSync(join(productsDir, 'Sparkle.framework'), frameworkPath, { recursive: true });
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
  const linked = run('otool', ['-L', helperPath], { capture: true });
  if (!linked.includes('@rpath/Sparkle.framework')) {
    throw new Error('Sparkle helper is not linked against Sparkle.framework');
  }
}

type RunOptions = { capture?: boolean };

function run(command: string, args: string[], options: RunOptions = {}): string {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with exit code ${result.status}: ${result.stderr?.trim() ?? ''}`
    );
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
