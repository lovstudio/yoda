import { existsSync } from 'node:fs';

type ElectronLoader = () => Promise<unknown>;
type ExecutableExists = (filePath: string) => boolean;
type PrepareElectronBundle = () => string | undefined;

interface ResolveDevElectronExecutableOptions {
  configuredExecutable?: string;
  loadElectron?: ElectronLoader;
  executableExists?: ExecutableExists;
  prepareElectronBundle?: PrepareElectronBundle;
}

/**
 * Load Electron's package entry before electron-vite starts.
 *
 * Electron 42 downloads its runtime lazily from that entry instead of using a
 * postinstall script. electron-vite 5 only reads path.txt, so it cannot trigger
 * the download itself when a fresh install has no runtime yet.
 */
export async function resolveDevElectronExecutable({
  configuredExecutable,
  loadElectron = () => import('electron'),
  executableExists = existsSync,
  prepareElectronBundle = () => undefined,
}: ResolveDevElectronExecutableOptions = {}): Promise<string> {
  if (configuredExecutable) {
    assertElectronExecutableExists(configuredExecutable, executableExists);
    return configuredExecutable;
  }

  const packageExecutable = unwrapElectronExecutable(await loadElectron());

  if (!packageExecutable) {
    throw new Error('Electron package did not resolve to an executable path.');
  }
  assertElectronExecutableExists(packageExecutable, executableExists);

  const executable = prepareElectronBundle() || packageExecutable;
  assertElectronExecutableExists(executable, executableExists);
  return executable;
}

function unwrapElectronExecutable(loadedElectron: unknown): string | undefined {
  if (typeof loadedElectron === 'string') return loadedElectron;
  if (!loadedElectron || typeof loadedElectron !== 'object') return undefined;

  const moduleNamespace = loadedElectron as Record<string, unknown>;
  return typeof moduleNamespace.default === 'string' ? moduleNamespace.default : undefined;
}

function assertElectronExecutableExists(
  executable: string,
  executableExists: ExecutableExists
): void {
  if (!executableExists(executable)) {
    throw new Error(`Electron executable does not exist: ${executable}`);
  }
}
