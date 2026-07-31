import { ensureUniqueTaskSlug } from '@shared/task-name';
import type { MountedProject } from '@renderer/features/projects/stores/project';

function slugifyLabel(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'op';
}

function timestampSuffix(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

export function createQuickActionTaskName(
  project: MountedProject,
  label: string,
  now = new Date()
): string {
  const baseName = `ops-${slugifyLabel(label)}-${timestampSuffix(now)}`;
  const existingNames = Array.from(project.taskManager.tasks.values(), (task) => task.data.name);
  return ensureUniqueTaskSlug(baseName, existingNames);
}
