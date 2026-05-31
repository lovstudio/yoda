import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { deriveTaskSlug } from '@shared/task-name';

const PROJECTLESS_ROOT_DIR = 'Yoda';
const PROJECTLESS_TITLE_FALLBACK = 'session';
const MAX_COLLISION_ATTEMPTS = 100;

type ProjectlessDirectoryOptions = {
  homeDir: string;
  title: string;
  now?: Date;
};

function formatLocalDate(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function projectlessTitleSegment(title: string): string {
  return deriveTaskSlug(title) || PROJECTLESS_TITLE_FALLBACK;
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

export function resolveProjectlessBaseDirectory(options: ProjectlessDirectoryOptions): string {
  return join(
    options.homeDir,
    'Documents',
    PROJECTLESS_ROOT_DIR,
    formatLocalDate(options.now ?? new Date())
  );
}

export function resolveProjectlessDefaultDirectory(options: ProjectlessDirectoryOptions): string {
  return join(resolveProjectlessBaseDirectory(options), projectlessTitleSegment(options.title));
}

export async function createProjectlessDefaultDirectory(
  options: ProjectlessDirectoryOptions
): Promise<string> {
  const baseDirectory = resolveProjectlessBaseDirectory(options);
  const titleSegment = projectlessTitleSegment(options.title);

  await mkdir(baseDirectory, { recursive: true });

  for (let attempt = 0; attempt < MAX_COLLISION_ATTEMPTS; attempt++) {
    const candidate = attempt === 0 ? titleSegment : `${titleSegment}-${(attempt + 1).toString()}`;
    const directory = join(baseDirectory, candidate);

    try {
      await mkdir(directory);
      return directory;
    } catch (error) {
      if (isAlreadyExistsError(error)) continue;
      throw error;
    }
  }

  const fallbackDirectory = join(baseDirectory, `${titleSegment}-${Date.now().toString(36)}`);
  await mkdir(fallbackDirectory);
  return fallbackDirectory;
}
