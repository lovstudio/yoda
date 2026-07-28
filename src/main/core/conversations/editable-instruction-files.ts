import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  EditableRuntimeInstructionFile,
  EditableRuntimeInstructionFilesRequest,
  RuntimeInstructionFile,
  SaveEditableRuntimeInstructionFileRequest,
} from '@shared/conversations';
import { getRuntime } from '@shared/runtime-registry';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { FileSystemErrorCodes } from '@main/core/fs/types';
import { getProjectById } from '@main/core/projects/operations/getProjects';
import { runtimeOverrideSettings } from '@main/core/settings/runtime-settings-service';
import { sshConnectionManager } from '@main/core/ssh/ssh-connection-manager';
import { resolveRemoteHome } from '@main/core/ssh/utils';
import { resolveRuntimeStateDirectory } from './impl/runtime-env';

const MAX_INSTRUCTION_FILE_BYTES = 2 * 1024 * 1024;

type InstructionFileCandidate = {
  kind: RuntimeInstructionFile['kind'];
  path: string;
  scope: EditableRuntimeInstructionFile['scope'];
};

type InstructionFileHost = {
  candidates: InstructionFileCandidate[];
  normalize: (filePath: string) => string;
  read: (filePath: string) => Promise<string>;
  write: (filePath: string, content: string) => Promise<void>;
};

function candidatesFor(
  cli: string,
  stateDirectory: string,
  projectPath: string | undefined,
  pathApi: Pick<typeof path.posix, 'join'>
): InstructionFileCandidate[] {
  if (cli === 'claude') {
    return [
      {
        kind: 'global-claude',
        path: pathApi.join(stateDirectory, 'CLAUDE.md'),
        scope: 'user',
      },
      ...(projectPath
        ? ([
            {
              kind: 'project-claude',
              path: pathApi.join(projectPath, 'CLAUDE.md'),
              scope: 'project',
            },
            {
              kind: 'project-claude',
              path: pathApi.join(projectPath, '.claude', 'CLAUDE.md'),
              scope: 'project',
            },
            {
              kind: 'project-claude',
              path: pathApi.join(projectPath, 'CLAUDE.local.md'),
              scope: 'project',
            },
          ] satisfies InstructionFileCandidate[])
        : []),
    ];
  }
  if (cli === 'codex') {
    return [
      {
        kind: 'global-codex-agents',
        path: pathApi.join(stateDirectory, 'AGENTS.override.md'),
        scope: 'user',
      },
      {
        kind: 'global-codex-agents',
        path: pathApi.join(stateDirectory, 'AGENTS.md'),
        scope: 'user',
      },
      ...(projectPath
        ? ([
            {
              kind: 'project-agents',
              path: pathApi.join(projectPath, 'AGENTS.override.md'),
              scope: 'project',
            },
            {
              kind: 'project-agents',
              path: pathApi.join(projectPath, 'AGENTS.md'),
              scope: 'project',
            },
          ] satisfies InstructionFileCandidate[])
        : []),
    ];
  }
  return [];
}

async function resolveInstructionFileHost({
  runtimeId,
  projectId,
}: EditableRuntimeInstructionFilesRequest): Promise<InstructionFileHost> {
  const cli = getRuntime(runtimeId)?.cli;
  if (cli !== 'claude' && cli !== 'codex') {
    return {
      candidates: [],
      normalize: path.resolve,
      read: async () => '',
      write: async () => undefined,
    };
  }
  const providerConfig = await runtimeOverrideSettings.getItem(runtimeId);

  const project = projectId ? await getProjectById(projectId) : null;
  if (project?.type === 'ssh') {
    const proxy = await sshConnectionManager.connect(project.connectionId);
    const executionContext = new SshExecutionContext(proxy);
    const remoteHome = await resolveRemoteHome(executionContext);
    executionContext.dispose();
    const remoteFs = new SshFileSystem(proxy, '/');
    const stateDirectory = resolveRuntimeStateDirectory(cli, providerConfig, {
      home: remoteHome,
      processEnv: {},
    });
    return {
      candidates: candidatesFor(cli, stateDirectory, project.path, path.posix),
      normalize: path.posix.normalize,
      read: async (filePath) => (await remoteFs.read(filePath, MAX_INSTRUCTION_FILE_BYTES)).content,
      write: async (filePath, content) => {
        await remoteFs.write(filePath, content);
      },
    };
  }

  const projectPath = project?.type === 'local' ? project.path : undefined;
  const stateDirectory = resolveRuntimeStateDirectory(cli, providerConfig);
  return {
    candidates: candidatesFor(cli, stateDirectory, projectPath, path),
    normalize: path.resolve,
    read: (filePath) => fs.readFile(filePath, 'utf8'),
    write: async (filePath, content) => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf8');
    },
  };
}

async function readCandidate(
  host: InstructionFileHost,
  candidate: InstructionFileCandidate
): Promise<EditableRuntimeInstructionFile> {
  try {
    const content = await host.read(candidate.path);
    return {
      kind: candidate.kind,
      path: candidate.path,
      scope: candidate.scope,
      exists: true,
      content,
      bytes: Buffer.byteLength(content),
    } as EditableRuntimeInstructionFile;
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
    if (code !== 'ENOENT' && code !== FileSystemErrorCodes.NOT_FOUND) throw error;
    return {
      kind: candidate.kind,
      path: candidate.path,
      scope: candidate.scope,
      exists: false,
      content: '',
      bytes: 0,
    } as EditableRuntimeInstructionFile;
  }
}

export async function getEditableRuntimeInstructionFiles(
  request: EditableRuntimeInstructionFilesRequest
): Promise<EditableRuntimeInstructionFile[]> {
  const host = await resolveInstructionFileHost(request);
  return Promise.all(host.candidates.map((candidate) => readCandidate(host, candidate)));
}

export async function saveEditableRuntimeInstructionFile(
  request: SaveEditableRuntimeInstructionFileRequest
): Promise<EditableRuntimeInstructionFile> {
  if (Buffer.byteLength(request.content) > MAX_INSTRUCTION_FILE_BYTES) {
    throw new Error('Instruction file exceeds 2 MB');
  }

  const host = await resolveInstructionFileHost(request);
  const normalizedPath = host.normalize(request.path);
  const candidate = host.candidates.find((item) => host.normalize(item.path) === normalizedPath);
  if (!candidate) throw new Error('Instruction file is outside the selected prompt layer');

  await host.write(candidate.path, request.content);
  return {
    kind: candidate.kind,
    path: candidate.path,
    scope: candidate.scope,
    exists: true,
    content: request.content,
    bytes: Buffer.byteLength(request.content),
  } as EditableRuntimeInstructionFile;
}
