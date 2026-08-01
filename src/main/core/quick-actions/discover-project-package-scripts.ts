import type { ProjectPackageScript } from '@shared/quick-actions';
import type { FileSystemProvider } from '@main/core/fs/types';

type ProjectManifestReader = Pick<FileSystemProvider, 'exists' | 'read'>;
type PackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn';

const PACKAGE_JSON_MAX_BYTES = 512 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function packageManagerFromField(value: unknown): PackageManager | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().split('@', 1)[0];
  if (name === 'bun' || name === 'npm' || name === 'pnpm' || name === 'yarn') return name;
  return null;
}

async function detectPackageManager(
  fs: ProjectManifestReader,
  packageManagerField: unknown
): Promise<PackageManager> {
  const declared = packageManagerFromField(packageManagerField);
  if (declared) return declared;

  const lockfiles = await Promise.all([
    fs.exists('pnpm-lock.yaml').catch(() => false),
    fs.exists('yarn.lock').catch(() => false),
    Promise.all([
      fs.exists('bun.lock').catch(() => false),
      fs.exists('bun.lockb').catch(() => false),
    ]).then((values) => values.some(Boolean)),
  ]);
  if (lockfiles[0]) return 'pnpm';
  if (lockfiles[1]) return 'yarn';
  if (lockfiles[2]) return 'bun';
  return 'npm';
}

function buildPackageScriptCommand(packageManager: PackageManager, scriptName: string): string {
  const scriptArgument = /^[A-Za-z0-9:._-]+$/.test(scriptName)
    ? scriptName
    : `'${scriptName.replace(/'/g, "'\\''")}'`;
  return `${packageManager} run ${scriptArgument}`;
}

/**
 * Reads every package.json script as a command candidate for the quick-action
 * creation modal. Discovery never makes a script visible in the quick-action
 * list by itself; the user must select and run it first.
 */
export async function discoverProjectPackageScripts(
  fs: ProjectManifestReader
): Promise<ProjectPackageScript[]> {
  let packageJson: unknown;
  try {
    const result = await fs.read('package.json', PACKAGE_JSON_MAX_BYTES);
    if (result.truncated) return [];
    packageJson = JSON.parse(result.content);
  } catch {
    return [];
  }
  if (!isRecord(packageJson) || !isRecord(packageJson.scripts)) return [];

  const packageManager = await detectPackageManager(fs, packageJson.packageManager);
  return Object.entries(packageJson.scripts)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([name]) => ({
      id: `package.json:${name}`,
      label: name,
      command: buildPackageScriptCommand(packageManager, name),
      source: 'package.json',
    }));
}
