import { randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, readdir, rename, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { log } from '@main/lib/logger';

export type MovedProjectDirectory = {
  targetPath: string;
  rollback: () => Promise<void>;
  finalize: () => Promise<void>;
};

export function normalizeLocalProjectPath(projectPath: string): string {
  return path.resolve(projectPath);
}

export async function localPathExists(projectPath: string): Promise<boolean> {
  try {
    await lstat(projectPath);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

export function assertProjectMoveTarget(
  sourcePath: string,
  targetPath: string,
  pathApi: Pick<typeof path, 'isAbsolute' | 'relative' | 'sep'> = path
): void {
  const relativeTarget = pathApi.relative(sourcePath, targetPath);
  if (relativeTarget === '') {
    throw new Error('The new project path must be different from the current path');
  }
  if (
    relativeTarget !== '..' &&
    !relativeTarget.startsWith(`..${pathApi.sep}`) &&
    !pathApi.isAbsolute(relativeTarget)
  ) {
    throw new Error('The new project path cannot be inside the current project directory');
  }
}

export async function moveLocalProjectDirectory(
  sourcePath: string,
  requestedTargetPath: string
): Promise<MovedProjectDirectory> {
  const source = normalizeLocalProjectPath(sourcePath);
  const target = normalizeLocalProjectPath(requestedTargetPath);
  assertProjectMoveTarget(source, target);

  await mkdir(path.dirname(target), { recursive: true });
  const restoreEmptyTarget = await removeEmptyTargetIfPresent(target);

  try {
    await rename(source, target);
    return {
      targetPath: target,
      rollback: async () => {
        await rename(target, source);
        if (restoreEmptyTarget) await mkdir(target);
      },
      finalize: async () => {},
    };
  } catch (error) {
    if (!isCrossDeviceError(error)) {
      if (restoreEmptyTarget) await mkdir(target);
      throw error;
    }
  }

  return copyAcrossDevices(source, target, restoreEmptyTarget);
}

async function copyAcrossDevices(
  source: string,
  target: string,
  restoreEmptyTarget: boolean
): Promise<MovedProjectDirectory> {
  const targetParent = path.dirname(target);
  const sourceParent = path.dirname(source);
  const token = randomUUID();
  const temporaryTarget = path.join(targetParent, `.${path.basename(target)}.yoda-move-${token}`);
  const sourceBackup = path.join(sourceParent, `.${path.basename(source)}.yoda-move-${token}`);

  try {
    await cp(source, temporaryTarget, {
      recursive: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
    });
    await rename(temporaryTarget, target);
    await rename(source, sourceBackup);
  } catch (error) {
    await removeIfPresent(temporaryTarget);
    if (await localPathExists(source)) {
      await removeIfPresent(target);
    }
    if (restoreEmptyTarget) await mkdir(target);
    throw error;
  }

  return {
    targetPath: target,
    rollback: async () => {
      await rename(sourceBackup, source);
      await removeIfPresent(target);
      if (restoreEmptyTarget) await mkdir(target);
    },
    finalize: async () => {
      try {
        await removeIfPresent(sourceBackup);
      } catch (error) {
        log.warn('moveProjectPath: failed to remove cross-device move backup', {
          sourceBackup,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

async function removeEmptyTargetIfPresent(target: string): Promise<boolean> {
  if (!(await localPathExists(target))) return false;

  const targetStat = await lstat(target);
  if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) {
    throw new Error(`The target path already exists: ${target}`);
  }
  if ((await readdir(target)).length > 0) {
    throw new Error(`The target path already exists and is not empty: ${target}`);
  }

  await rmdir(target);
  return true;
}

async function removeIfPresent(target: string): Promise<void> {
  await rm(target, { recursive: true, force: true });
}

function isNotFoundError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function isCrossDeviceError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'EXDEV';
}
