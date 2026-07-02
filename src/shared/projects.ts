export type ProjectPathStatus = {
  isDirectory: boolean;
  isGitRepo: boolean;
};

/**
 * Fixed ID of the singleton internal "Drafts" project (no git, hidden from
 * the project list, hosts standalone agent sessions started from the home
 * input with no project selected). Bootstrapped at app start.
 */
export const INTERNAL_PROJECT_ID = 'yoda-internal-drafts';

export type LocalProject = {
  type: 'local';
  id: string;
  name: string;
  alias: string | null;
  path: string;
  baseRef: string;
  workspaceId: string | null;
  isInternal: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SshProject = {
  type: 'ssh';
  id: string;
  name: string;
  alias: string | null;
  path: string;
  baseRef: string;
  connectionId: string;
  workspaceId: string | null;
  isInternal: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Project = LocalProject | SshProject;

export function projectDisplayName(p: Pick<LocalProject, 'name' | 'alias'>): string {
  const alias = p.alias?.trim();
  return alias && alias.length > 0 ? alias : p.name;
}

export const MAX_PROJECT_ALIAS_LENGTH = 80;

export type MoveProjectPathParams = {
  name: string;
  path: string;
};

export type CreateLocalProjectParams = {
  type: 'local';
  id?: string;
  path: string;
  name: string;
  initGitRepository?: boolean;
  /** Sidebar workspace to assign the new project to (omit for the default workspace). */
  workspaceId?: string;
};

export type CreateSshProjectParams = {
  type: 'ssh';
  id?: string;
  name: string;
  path: string;
  connectionId: string;
  initGitRepository?: boolean;
  /** Sidebar workspace to assign the new project to (omit for the default workspace). */
  workspaceId?: string;
};

export type CreateProjectParams = CreateLocalProjectParams | CreateSshProjectParams;

export type InspectLocalProjectPathParams = {
  type: 'local';
  path: string;
};

export type InspectSshProjectPathParams = {
  type: 'ssh';
  path: string;
  connectionId: string;
};

export type InspectProjectPathParams = InspectLocalProjectPathParams | InspectSshProjectPathParams;

export type ProjectPathInspection = ProjectPathStatus & {
  existingProject?: Project;
};

export type OpenProjectError =
  | { type: 'path-not-found'; path: string }
  | { type: 'ssh-disconnected'; connectionId: string }
  | { type: 'error'; message: string };

export type UpdateProjectSettingsError =
  | { type: 'project-not-found' }
  | { type: 'invalid-settings' }
  | { type: 'invalid-worktree-directory' }
  | { type: 'write-config-failed'; message: string }
  | { type: 'error' };

export type ProjectRemoteState = {
  hasRemote: boolean;
  selectedRemoteUrl: string | null;
};
