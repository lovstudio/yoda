import { HEAD_REF } from '@shared/git';
import {
  FileModelLifecycleStore,
  type FileTabsHost,
} from '@renderer/features/tasks/editor/stores/file-model-lifecycle-store';
import { FileTabStore } from '@renderer/features/tasks/tabs/file-tab-store';
import type { FileRendererData } from '@renderer/features/tasks/types';
import { rpc } from '@renderer/lib/ipc';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import { appState } from '@renderer/lib/stores/app-state';

/**
 * A project-level file editing session: one open file in the `file` app tab,
 * backed by the project-view workspace (acquired lazily, shared per project).
 * Sessions outlive view mounts — tab switches keep models (and unsaved edits)
 * alive; the session is disposed only when its app tab closes.
 *
 * `projectId: null` is the global variant: an absolute path with no project
 * (agent-home files like SKILL.md). No workspace is acquired — the main
 * process resolves those paths via the agent-home escape in fs.readFile.
 */
export type ProjectFileSession = {
  readonly projectId: string | null;
  readonly filePath: string;
  readonly workspaceId: string;
  readonly fileTab: FileTabStore;
  readonly lifecycle: FileModelLifecycleStore;
};

/** FileTabsHost over a single file — adapts FileTabStore to the lifecycle store. */
class SingleFileHost implements FileTabsHost {
  constructor(private readonly entry: FileTabStore) {}

  get openFilePaths(): string[] {
    return [this.entry.path];
  }

  get activeFileEntry(): FileTabStore {
    return this.entry;
  }

  setImageContent(filePath: string, content: string): void {
    if (filePath === this.entry.path) this.entry.setImageContent(content);
  }

  updateRenderer(filePath: string, updater: (prev: FileRendererData) => FileRendererData): void {
    if (filePath === this.entry.path) this.entry.updateRenderer(updater);
  }

  setFileTotalSize(filePath: string, size: number): void {
    if (filePath === this.entry.path) this.entry.setTotalSize(size);
  }
}

const sessions = new Map<string, ProjectFileSession>();
const workspaceIds = new Map<string, Promise<string>>();
let tabCloseWired = false;

function sessionKey(projectId: string | null, filePath: string): string {
  return `${projectId ?? ''}::${filePath}`;
}

/**
 * Opens (or focuses) the app tab for a project file (or a project-less
 * absolute path when `projectId` is null). Browser semantics: an existing tab
 * for the same file is activated instead of duplicated.
 */
export function openProjectFileTab(projectId: string | null, filePath: string): void {
  const existing = appState.appTabs.tabs.find(
    (tab) =>
      tab.viewId === 'file' &&
      (tab.params.projectId ?? null) === projectId &&
      tab.params.filePath === filePath
  );
  if (existing) {
    appState.appTabs.activateTab(existing.id);
    return;
  }
  appState.appTabs.openTab('file', projectId ? { projectId, filePath } : { filePath });
}

export async function getProjectFileSession(
  projectId: string | null,
  filePath: string
): Promise<ProjectFileSession> {
  wireTabCloseDisposal();

  const key = sessionKey(projectId, filePath);
  const existing = sessions.get(key);
  if (existing) return existing;

  // Global files need no workspace — fs RPCs resolve them via the agent-home
  // escape; the sentinel only namespaces the Monaco model root.
  const workspaceId = projectId ? await getProjectViewWorkspaceId(projectId) : 'global';

  // Re-check after the await — a concurrent caller may have created it.
  const raced = sessions.get(key);
  if (raced) return raced;

  const fileTab = new FileTabStore(filePath, false);
  const lifecycle = new FileModelLifecycleStore(
    new SingleFileHost(fileTab),
    projectId ?? '',
    workspaceId
  );
  const session: ProjectFileSession = { projectId, filePath, workspaceId, fileTab, lifecycle };
  sessions.set(key, session);
  return session;
}

export async function refreshProjectFile(
  projectId: string | null,
  filePath: string
): Promise<void> {
  const session = await getProjectFileSession(projectId, filePath);
  await session.lifecycle.refreshFile(filePath);
}

/** One project-view workspace per project, acquired once and kept for the app's lifetime. */
function getProjectViewWorkspaceId(projectId: string): Promise<string> {
  const cached = workspaceIds.get(projectId);
  if (cached) return cached;

  const promise = rpc.projects.acquireProjectViewWorkspace(projectId).then((result) => {
    if (!result.success) {
      workspaceIds.delete(projectId);
      throw new Error(formatError(result.error));
    }
    return result.data.workspaceId;
  });
  workspaceIds.set(projectId, promise);
  return promise;
}

function disposeSession(key: string): void {
  const session = sessions.get(key);
  if (!session) return;
  sessions.delete(key);
  session.lifecycle.dispose();

  const uri = buildMonacoModelPath(session.lifecycle.modelRootPath, session.filePath);
  const dirty = modelRegistry.isDirty(uri);
  modelRegistry.unregisterModel(uri);
  modelRegistry.unregisterModel(modelRegistry.toDiskUri(uri));
  modelRegistry.unregisterModel(modelRegistry.toGitUri(uri, HEAD_REF));
  // Hot-exit: keep the crash-recovery buffer for dirty files so reopening the
  // tab restores unsaved edits; clean files release their buffer immediately.
  if (!dirty && session.projectId) {
    void rpc.editorBuffer.clearBuffer(session.projectId, session.workspaceId, session.filePath);
  }
}

function wireTabCloseDisposal(): void {
  if (tabCloseWired) return;
  tabCloseWired = true;
  appState.appTabs.onTabClose((tab) => {
    if (tab.viewId !== 'file') return;
    const { projectId, filePath } = tab.params as { projectId?: string; filePath?: string };
    if (typeof filePath === 'string') {
      disposeSession(sessionKey(projectId ?? null, filePath));
    }
  });
}

function formatError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(error);
}
