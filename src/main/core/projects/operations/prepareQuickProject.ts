import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { appSettingsService } from '@main/core/settings/settings-service';

export interface PrepareQuickProjectParams {
  /** Optional user-typed title. Falls back to a date-based name when empty. */
  name?: string;
}

export interface PrepareQuickProjectResult {
  /** Absolute path of the freshly created (empty) project directory. */
  path: string;
  /** Display name for the project record. */
  name: string;
}

/** Filesystem-safe directory leaf. Keeps Unicode letters/numbers (e.g. CJK),
 *  collapses everything else to single dashes. */
function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function dateStamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Express-create: resolve a path under the configured default projects
 * directory, create an empty directory there, and return it so the caller can
 * register it as a (git-initialized) project. No folder picking required.
 */
export async function prepareQuickProject(
  params: PrepareQuickProjectParams
): Promise<PrepareQuickProjectResult> {
  const { defaultProjectsDirectory } = await appSettingsService.get('localProject');

  const trimmed = params.name?.trim() ?? '';
  const displayName = trimmed || `Project ${dateStamp()}`;
  const baseSlug = (trimmed ? slugify(trimmed) : '') || `project-${dateStamp()}`;

  // Avoid colliding with an existing directory: project-2, project-3, …
  let slug = baseSlug;
  let attempt = 1;
  while (existsSync(join(defaultProjectsDirectory, slug))) {
    attempt += 1;
    slug = `${baseSlug}-${attempt}`;
  }

  const path = join(defaultProjectsDirectory, slug);
  await mkdir(path, { recursive: true });
  return { path, name: displayName };
}
