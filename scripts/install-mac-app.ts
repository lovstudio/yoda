import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const productName = process.env.VITE_BUILD === 'canary' ? 'Yoda Canary' : 'Yoda';
const appName = `${productName}.app`;
const releaseDir = resolve('release');
const applicationsDir = '/Applications';
const installPath = join(applicationsDir, appName);

if (process.platform !== 'darwin') {
  console.log('install-mac-app: skipped because this is not macOS');
  process.exit(0);
}

if (!existsSync(releaseDir)) {
  fail(`release directory does not exist: ${releaseDir}`);
}

const appPath = findBuiltApp();
if (!appPath) {
  fail(`could not find ${appName} under ${releaseDir}`);
}

console.log(`install-mac-app: installing ${appPath} to ${installPath}`);

try {
  rmSync(installPath, { force: true, recursive: true });
  run('ditto', [appPath, installPath]);
  console.log(`install-mac-app: installed ${appName}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  fail(`failed to install ${appName} to ${applicationsDir}: ${message}`);
}

function findBuiltApp(): string | null {
  const candidates = readdirSync(releaseDir)
    .filter((name) => name.startsWith('mac'))
    .sort((a, b) => scoreMacDir(b) - scoreMacDir(a))
    .map((name) => join(releaseDir, name, appName))
    .filter((path) => existsSync(path));

  return candidates[0] ?? null;
}

function scoreMacDir(name: string): number {
  if (process.arch === 'arm64' && basename(name).includes('arm64')) return 2;
  if (process.arch === 'x64' && basename(name).includes('x64')) return 2;
  if (basename(name) === 'mac') return 1;
  return 0;
}

function fail(message: string): never {
  console.error(`install-mac-app: ${message}`);
  process.exit(1);
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`);
  }
}
