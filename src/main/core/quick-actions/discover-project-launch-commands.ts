import type { ProjectLaunchCommand } from '@shared/quick-actions';
import type { FileSystemProvider } from '@main/core/fs/types';

type ProjectManifestReader = Pick<FileSystemProvider, 'exists' | 'read'>;
type PackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn';

const PACKAGE_JSON_MAX_BYTES = 512 * 1024;
const LAUNCH_SCRIPT_NAMES = [
  'dev',
  'start',
  'serve',
  'preview',
  'watch',
  'desktop',
  'web',
  'app',
  'docs',
  'doc',
  'mobile',
] as const;

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

function launchScriptRank(name: string, command: string): number | null {
  const normalized = name.toLowerCase();
  const exactRank = LAUNCH_SCRIPT_NAMES.indexOf(normalized as (typeof LAUNCH_SCRIPT_NAMES)[number]);
  if (exactRank >= 0) return exactRank;

  const segments = normalized.split(/[:_-]/);
  const segmentRank = segments.reduce<number | null>((best, segment) => {
    const rank = LAUNCH_SCRIPT_NAMES.indexOf(segment as (typeof LAUNCH_SCRIPT_NAMES)[number]);
    if (rank < 0) return best;
    return best === null ? rank : Math.min(best, rank);
  }, null);
  if (segmentRank !== null) return LAUNCH_SCRIPT_NAMES.length + segmentRank;

  const delegatesToLaunchScript =
    /(?:^|[;&|]\s*)(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+(?:dev|start|serve|preview)(?:\s|$)/i;
  return delegatesToLaunchScript.test(command) ? LAUNCH_SCRIPT_NAMES.length * 2 : null;
}

function buildPackageScriptCommand(packageManager: PackageManager, scriptName: string): string {
  const scriptArgument = /^[A-Za-z0-9:._-]+$/.test(scriptName)
    ? scriptName
    : `'${scriptName.replace(/'/g, "'\\''")}'`;
  return `${packageManager} run ${scriptArgument}`;
}

/**
 * Reads repository-owned manifests and returns only commands that are plausible
 * interactive launchers. Validation/build/cleanup scripts stay out of the
 * sidebar so opening a project menu never exposes a destructive-looking wall of
 * every package script.
 */
export async function discoverProjectLaunchCommands(
  fs: ProjectManifestReader
): Promise<ProjectLaunchCommand[]> {
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
    .flatMap(([name, value]) => {
      if (typeof value !== 'string') return [];
      const rank = launchScriptRank(name, value);
      if (rank === null) return [];
      return [{ name, rank }];
    })
    .sort((left, right) => left.rank - right.rank || left.name.localeCompare(right.name))
    .map(({ name }) => ({
      id: `package.json:${name}`,
      label: name,
      command: buildPackageScriptCommand(packageManager, name),
      source: 'package.json',
    }));
}
