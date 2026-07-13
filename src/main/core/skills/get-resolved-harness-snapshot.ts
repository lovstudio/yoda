import type { ResolvedHarnessSnapshot } from '@shared/harness';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { getProjectById } from '@main/core/projects/operations/getProjects';
import { sshConnectionManager } from '@main/core/ssh/ssh-connection-manager';
import { resolveHarnessSnapshot } from './skill-harness-resolver';
import { skillsService } from './SkillsService';

export async function getResolvedHarnessSnapshot(
  projectId: string
): Promise<ResolvedHarnessSnapshot> {
  const project = await getProjectById(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const fileSystem =
    project.type === 'ssh'
      ? new SshFileSystem(await sshConnectionManager.connect(project.connectionId), project.path)
      : new LocalFileSystem(project.path);
  const catalog =
    project.type === 'local' ? await skillsService.getCatalogIndex(project.path) : undefined;

  return resolveHarnessSnapshot({
    projectId,
    projectPath: project.path,
    projectType: project.type,
    fileSystem,
    catalog,
  });
}
