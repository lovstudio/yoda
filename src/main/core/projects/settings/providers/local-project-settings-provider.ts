import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UpdateProjectSettingsError } from '@shared/projects';
import type { Result } from '@shared/result';
import { appSettingsService } from '@main/core/settings/settings-service';
import {
  getDefaultLocalWorktreeDirectory,
  getProjectLocalWorktreeDirectory,
} from '@main/core/settings/worktree-defaults';
import type { ProjectSettingsStorage } from '../project-settings-storage';
import {
  normalizeWorktreeDirectory,
  resolveAndValidateWorktreeDirectory,
} from '../worktree-directory';
import { DbProjectSettingsProvider } from './db-project-settings-provider';

const localPathPlatform = process.platform === 'win32' ? 'win32' : 'posix';

async function getLocalDefaultWorktreeDirectory(projectPath: string): Promise<string> {
  const settings = await appSettingsService.get('localProject');
  if (settings.worktreeLocationMode === 'project') {
    return getProjectLocalWorktreeDirectory(projectPath);
  }
  const normalized = await normalizeWorktreeDirectory(settings.defaultWorktreeDirectory, {
    pathApi: path,
    pathPlatform: localPathPlatform,
    homeDirectory: os.homedir(),
  });
  return normalized.success ? normalized.data : getDefaultLocalWorktreeDirectory();
}

export class LocalProjectSettingsProvider extends DbProjectSettingsProvider {
  constructor(
    projectId: string,
    projectPath: string,
    defaultBranchFallback: string = 'main',
    storage?: ProjectSettingsStorage
  ) {
    super(
      projectId,
      projectPath,
      defaultBranchFallback,
      {
        exists: async (filePath) => fs.existsSync(path.join(projectPath, filePath)),
        read: async (filePath) => {
          const content = await fs.promises.readFile(path.join(projectPath, filePath), 'utf8');
          return { content, truncated: false, totalSize: Buffer.byteLength(content) };
        },
      },
      storage
    );
  }

  protected defaultWorktreeDirectory(): Promise<string> {
    return getLocalDefaultWorktreeDirectory(this.projectPath);
  }

  protected validateWorktreeDirectory(
    worktreeDirectory: string | undefined
  ): Promise<Result<string | undefined, UpdateProjectSettingsError>> {
    return resolveAndValidateWorktreeDirectory(worktreeDirectory, {
      pathApi: path,
      pathPlatform: localPathPlatform,
      fs: {
        mkdir: async (p, options) => {
          await fs.promises.mkdir(p, options);
        },
        realPath: async (p) => fs.promises.realpath(p),
      },
      homeDirectory: os.homedir(),
    });
  }

  protected normalizeStoredWorktreeDirectory(
    worktreeDirectory: string
  ): Promise<Result<string, UpdateProjectSettingsError>> {
    return normalizeWorktreeDirectory(worktreeDirectory, {
      pathApi: path,
      pathPlatform: localPathPlatform,
      homeDirectory: os.homedir(),
    });
  }
}
