import { promises as nativeFs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { planEventChannel } from '@shared/events/appEvents';
import { fsWatchEventChannel } from '@shared/events/fsEvents';
import { createRPCController } from '@shared/ipc/rpc';
import { err, ok } from '@shared/result';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { getProjectById } from '@main/core/projects/operations/getProjects';
import { projectManager } from '@main/core/projects/project-manager';
import { sshConnectionManager } from '@main/core/ssh/ssh-connection-manager';
import { events } from '@main/lib/events';
import { resolveWorkspace } from '../projects/utils';
import {
  FileSystemErrorCodes,
  type FileEntry,
  type FileListResult,
  type FileWatcher,
  type ListOptions,
  type SearchOptions,
} from './types';

// One watcher per (projectId, workspaceId) pair, shared across all consumers via labels.
// Local: single recursive @parcel/watcher subscription — update() is a no-op.
// SSH:   poll-based — update() receives the union of all labels' paths to poll.
const watcherRegistry = new Map<string, FileWatcher>();
// Per-label path groups, keyed by `${projectId}::${workspaceId}` → label → paths.
// Paths are forwarded to update() for SSH compatibility; local ignores them.
const watcherLabeledPaths = new Map<string, Map<string, string[]>>();

type PathCompletionOptions = ListOptions & {
  pathKind?: 'relative' | 'absolute';
};

function resolveLocalPathInsideBase(basePath: string, relPath: string): string {
  const resolvedBase = path.resolve(basePath);
  const resolvedPath = path.resolve(resolvedBase, relPath);
  const relativePath = path.relative(resolvedBase, resolvedPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Path escapes base directory: ${relPath}`);
  }
  return resolvedPath;
}

async function listLocalAbsolutePath(
  dirPath: string,
  options: ListOptions = {}
): Promise<FileListResult> {
  const startTime = Date.now();
  const maxEntries = options.maxEntries ?? 100;
  const items = await nativeFs.readdir(dirPath, { withFileTypes: true });
  const entries: FileEntry[] = [];

  for (const item of items) {
    if (!options.includeHidden && item.name.startsWith('.')) continue;
    if (entries.length >= maxEntries) break;

    const itemPath = path.join(dirPath, item.name);
    try {
      const stat = await nativeFs.stat(itemPath);
      entries.push({
        path: itemPath,
        type: item.isDirectory() ? 'dir' : 'file',
        size: stat.size,
        mtime: stat.mtime,
        ctime: stat.ctime,
        mode: stat.mode,
      });
    } catch {
      // Ignore entries that disappear or cannot be stat'ed.
    }
  }

  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.path.localeCompare(b.path);
  });

  return {
    entries,
    total: entries.length,
    truncated: entries.length < items.length,
    truncateReason: entries.length < items.length ? 'maxEntries' : undefined,
    durationMs: Date.now() - startTime,
  };
}

async function listLocalRelativePath(
  basePath: string,
  dirPath: string,
  options: ListOptions = {}
): Promise<FileListResult> {
  const absoluteDirPath = resolveLocalPathInsideBase(basePath, dirPath);
  const result = await listLocalAbsolutePath(absoluteDirPath, options);
  return {
    ...result,
    entries: result.entries.map((entry) => ({
      ...entry,
      path: path.relative(basePath, entry.path),
    })),
  };
}

export const filesController = createRPCController({
  listPathCompletions: async (
    projectId: string | null,
    dirPath: string,
    options?: PathCompletionOptions
  ) => {
    const { pathKind = 'relative', ...listOptions } = options ?? {};

    try {
      if (!projectId) {
        return ok(
          pathKind === 'absolute'
            ? await listLocalAbsolutePath(dirPath, {
                includeHidden: true,
                maxEntries: 100,
                ...listOptions,
              })
            : await listLocalRelativePath(homedir(), dirPath, {
                includeHidden: true,
                maxEntries: 100,
                ...listOptions,
              })
        );
      }

      const project = projectManager.getProject(projectId);
      const projectData = await getProjectById(projectId);
      if (!projectData) {
        return err({
          type: 'not_found' as const,
          entity: 'project' as const,
          detail: undefined,
        });
      }

      if (pathKind === 'absolute') {
        if (projectData.type === 'ssh') {
          const proxy = await sshConnectionManager.connect(projectData.connectionId);
          const rootFs = new SshFileSystem(proxy, '/');
          return ok(
            await rootFs.list(dirPath, {
              recursive: false,
              includeHidden: true,
              maxEntries: 100,
              ...listOptions,
            })
          );
        }

        return ok(
          await listLocalAbsolutePath(dirPath, {
            includeHidden: true,
            maxEntries: 100,
            ...listOptions,
          })
        );
      }

      if (!project && projectData.type === 'local') {
        return ok(
          await listLocalRelativePath(projectData.path, dirPath, {
            recursive: false,
            includeHidden: true,
            maxEntries: 100,
            ...listOptions,
          })
        );
      }

      if (!project && projectData.type === 'ssh') {
        const proxy = await sshConnectionManager.connect(projectData.connectionId);
        const projectFs = new SshFileSystem(proxy, projectData.path);
        return ok(
          await projectFs.list(dirPath, {
            recursive: false,
            includeHidden: true,
            maxEntries: 100,
            ...listOptions,
          })
        );
      }

      if (!project)
        return err({ type: 'not_found' as const, entity: 'project' as const, detail: undefined });

      return ok(
        await project.fs.list(dirPath, {
          recursive: false,
          includeHidden: true,
          maxEntries: 100,
          ...listOptions,
        })
      );
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  listFiles: async (
    projectId: string,
    workspaceId: string,
    dirPath: string,
    options?: ListOptions
  ) => {
    const env = resolveWorkspace(projectId, workspaceId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    try {
      const result = await env.fs.list(dirPath, options);
      return ok(result);
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  readFile: async (projectId: string, workspaceId: string, filePath: string, maxBytes?: number) => {
    const env = resolveWorkspace(projectId, workspaceId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    try {
      const result = await env.fs.read(filePath, maxBytes);
      return ok(result);
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  writeFile: async (projectId: string, workspaceId: string, filePath: string, content: string) => {
    const env = resolveWorkspace(projectId, workspaceId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    try {
      const result = await env.fs.write(filePath, content);
      return ok(result);
    } catch (e) {
      if (
        e instanceof Error &&
        (e as unknown as { code?: string }).code === FileSystemErrorCodes.PERMISSION_DENIED
      ) {
        events.emit(planEventChannel, {
          type: 'write_blocked' as const,
          root: projectId,
          relPath: filePath,
          message: e.message,
        });
      }
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  removeFile: async (projectId: string, workspaceId: string, filePath: string) => {
    const env = resolveWorkspace(projectId, workspaceId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    if (!env.fs.remove) {
      return err({
        type: 'fs_error' as const,
        message: 'remove not supported by this filesystem',
      });
    }

    try {
      const result = await env.fs.remove(filePath);
      return ok(result);
    } catch (e) {
      if (
        e instanceof Error &&
        (e as unknown as { code?: string }).code === FileSystemErrorCodes.PERMISSION_DENIED
      ) {
        events.emit(planEventChannel, {
          type: 'remove_blocked' as const,
          root: projectId,
          relPath: filePath,
          message: e.message,
        });
      }
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  readImage: async (projectId: string, workspaceId: string, filePath: string) => {
    const env = resolveWorkspace(projectId, workspaceId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    if (!env.fs.readImage) {
      return err({
        type: 'fs_error' as const,
        message: 'readImage not supported by this filesystem',
      });
    }

    try {
      const result = await env.fs.readImage(filePath);
      return ok(result);
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  searchFiles: async (
    projectId: string,
    workspaceId: string,
    query: string,
    options?: SearchOptions
  ) => {
    const env = resolveWorkspace(projectId, workspaceId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    try {
      const result = await env.fs.search(query, options);
      return ok(result);
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  statFile: async (projectId: string, workspaceId: string, filePath: string) => {
    const env = resolveWorkspace(projectId, workspaceId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    try {
      const entry = await env.fs.stat(filePath);
      return ok({ entry });
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  fileExists: async (projectId: string, workspaceId: string, filePath: string) => {
    const env = resolveWorkspace(projectId, workspaceId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    try {
      const exists = await env.fs.exists(filePath);
      return ok({ exists });
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  saveAttachment: async (
    projectId: string,
    workspaceId: string,
    srcPath: string,
    subdir?: string
  ) => {
    const env = resolveWorkspace(projectId, workspaceId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    if (!env.fs.saveAttachment) {
      return err({
        type: 'fs_error' as const,
        message: 'saveAttachment not supported by this filesystem',
      });
    }

    try {
      const result = await env.fs.saveAttachment(srcPath, subdir);
      return ok(result);
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  watchSetPaths: async (
    projectId: string,
    workspaceId: string,
    paths: string[],
    label = 'default'
  ) => {
    const env = resolveWorkspace(projectId, workspaceId);
    if (!env) {
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });
    }

    if (!env.fs.watch) {
      return ok({ supported: false as const });
    }

    const key = `${projectId}::${workspaceId}`;
    const groups = watcherLabeledPaths.get(key) ?? new Map<string, string[]>();
    groups.set(label, paths);
    watcherLabeledPaths.set(key, groups);
    const union = [...new Set([...groups.values()].flat())];

    const existing = watcherRegistry.get(key);
    if (existing) {
      existing.update(union);
    } else {
      const watcher = env.fs.watch((evts) => {
        events.emit(fsWatchEventChannel, { projectId, workspaceId, events: evts });
      });
      watcher.update(union);
      watcherRegistry.set(key, watcher);
    }
    return ok({ supported: true as const });
  },

  watchStop: async (projectId: string, workspaceId: string, label = 'default') => {
    const key = `${projectId}::${workspaceId}`;
    const groups = watcherLabeledPaths.get(key);
    groups?.delete(label);

    if (!groups?.size) {
      watcherLabeledPaths.delete(key);
      watcherRegistry.get(key)?.close();
      watcherRegistry.delete(key);
    } else {
      const union = [...new Set([...groups.values()].flat())];
      watcherRegistry.get(key)?.update(union);
    }
    return ok({});
  },
});
