import { computed, makeObservable, observable, reaction, runInAction } from 'mobx';
import { HEAD_REF } from '@shared/git';
import type { EditorViewSnapshot } from '@shared/view-state';
import type { FileTabStore } from '@renderer/features/tasks/tabs/file-tab-store';
import type { FileRendererData } from '@renderer/features/tasks/types';
import { getFileKind } from '@renderer/lib/editor/fileKind';
import { rpc } from '@renderer/lib/ipc';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import type { Snapshottable } from '@renderer/lib/stores/snapshottable';
import { getMonacoLanguageId } from '@renderer/utils/diffUtils';
import { log } from '@renderer/utils/logger';

/**
 * The slice of a tab manager that the model lifecycle needs. Structural so the
 * store works for both the task TabManagerStore and project-level file tabs.
 */
export interface FileTabsHost {
  readonly openFilePaths: string[];
  readonly activeFileEntry: FileTabStore | null | undefined;
  setImageContent(filePath: string, content: string): void;
  updateRenderer(filePath: string, updater: (prev: FileRendererData) => FileRendererData): void;
  setFileTotalSize(filePath: string, size: number): void;
}

/**
 * Owns Monaco model lifecycle (register/unregister) and file persistence (save, conflict).
 *
 * Replaces the model lifecycle reaction in TaskViewStore and the model-related
 * methods in EditorViewStore. Also manages the file-tree sidebar's expanded paths.
 *
 * Reactive model lifecycle: watches tabManager.openFilePaths and registers/unregisters
 * Monaco models (disk, git, buffer) accordingly. On registration results, updates the
 * corresponding FileTabStore directly (setImageContent, setTotalSize, updateRenderer).
 */
export class FileModelLifecycleStore implements Snapshottable<EditorViewSnapshot> {
  readonly modelRootPath: string;

  isSaving = false;
  /**
   * Set to the buffer URI of a file that has a conflict pending resolution.
   * EditorProvider watches this via a MobX reaction and shows the conflict modal.
   */
  pendingConflictUri: string | null = null;

  /** Persisted navigation state for the file tree sidebar. */
  expandedPaths = observable.set<string>();

  private readonly projectId: string;
  private readonly workspaceId: string;
  private readonly tabManager: FileTabsHost;
  private readonly disposers: (() => void)[] = [];

  constructor(tabManager: FileTabsHost, projectId: string, workspaceId: string) {
    this.tabManager = tabManager;
    this.projectId = projectId;
    this.workspaceId = workspaceId;
    this.modelRootPath = `workspace:${workspaceId}`;

    makeObservable(this, {
      isSaving: observable,
      pendingConflictUri: observable,
      activeBufferUri: computed,
      openFilePaths: computed,
      snapshot: computed,
    });

    // Reactive model lifecycle: register/unregister Monaco models as file tabs open/close.
    this.disposers.push(
      reaction(
        () => this.tabManager.openFilePaths,
        (current, previous = []) => {
          const prev = new Set(previous);
          const curr = new Set(current);
          for (const path of curr) {
            if (!prev.has(path)) {
              void this._registerModels(path);
            }
          }
          for (const path of prev) {
            if (!curr.has(path)) this._unregisterModels(path);
          }
        },
        { fireImmediately: true }
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Computed
  // ---------------------------------------------------------------------------

  /** Buffer URI of the active file tab, or null if no file tab is active. */
  get activeBufferUri(): string | null {
    const entry = this.tabManager.activeFileEntry;
    if (!entry) return null;
    return buildMonacoModelPath(this.modelRootPath, entry.path);
  }

  get openFilePaths(): string[] {
    return this.tabManager.openFilePaths;
  }

  // ---------------------------------------------------------------------------
  // Snapshottable
  // ---------------------------------------------------------------------------

  get snapshot(): EditorViewSnapshot {
    return {
      expandedPaths: [...this.expandedPaths],
    };
  }

  restoreSnapshot(snapshot: Partial<EditorViewSnapshot>): void {
    if (!Array.isArray(snapshot.expandedPaths)) return;

    this.expandedPaths.clear();
    for (const path of snapshot.expandedPaths) {
      if (typeof path === 'string') this.expandedPaths.add(path);
    }
  }

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  async saveFile(filePath: string): Promise<void> {
    const uri = buildMonacoModelPath(this.modelRootPath, filePath);
    if (!modelRegistry.isDirty(uri)) return;

    if (modelRegistry.hasPendingConflict(uri)) {
      runInAction(() => {
        this.pendingConflictUri = uri;
      });
      return;
    }

    runInAction(() => {
      this.isSaving = true;
    });
    try {
      const result = await modelRegistry.saveFileToDisk(uri);
      if (result === null) {
        log.error('[FileModelLifecycleStore] Failed to save file:', filePath);
      }
    } catch (error) {
      log.error('[FileModelLifecycleStore] Error saving file:', error);
    } finally {
      runInAction(() => {
        this.isSaving = false;
      });
    }
  }

  async saveAllFiles(): Promise<void> {
    const dirtyPaths = this.openFilePaths.filter((path) =>
      modelRegistry.isDirty(buildMonacoModelPath(this.modelRootPath, path))
    );
    for (const path of dirtyPaths) {
      await this.saveFile(path);
    }
  }

  /** Re-read an open file from disk without discarding unsaved text edits. */
  async refreshFile(filePath: string): Promise<void> {
    const kind = getFileKind(filePath);

    if (kind === 'image' || kind === 'pdf') {
      const result = await rpc.fs.readImage(this.projectId, this.workspaceId, filePath);
      if (!result.success) throw new Error(formatResultError(result.error));
      runInAction(() => {
        this.tabManager.setImageContent(filePath, result.data?.dataUrl ?? '');
      });
      return;
    }

    if (kind === 'text' || kind === 'markdown' || kind === 'svg') {
      const bufferUri = buildMonacoModelPath(this.modelRootPath, filePath);
      const refreshed = await modelRegistry.invalidateModel(modelRegistry.toDiskUri(bufferUri));
      if (!refreshed) throw new Error('Failed to read the file from disk');
      return;
    }

    throw new Error('This file type cannot be refreshed');
  }

  /**
   * Resolves a pending conflict: either reloads buffer from disk ("Accept Incoming")
   * or writes the user's buffer to disk ("Keep Mine").
   */
  async resolveConflict(accept: boolean): Promise<void> {
    const uri = this.pendingConflictUri;
    if (!uri) return;
    runInAction(() => {
      this.pendingConflictUri = null;
    });

    if (accept) {
      modelRegistry.reloadFromDisk(uri);
      const filePath = uri.replace(`file://${this.modelRootPath}/`, '');
      void rpc.editorBuffer.clearBuffer(this.projectId, this.workspaceId, filePath);
    } else {
      runInAction(() => {
        this.isSaving = true;
      });
      try {
        await modelRegistry.saveFileToDisk(uri);
      } finally {
        runInAction(() => {
          this.isSaving = false;
        });
      }
    }
  }

  /**
   * Restores crash-recovery buffer content for any open tabs whose models are
   * already registered. Called by EditorProvider on mount.
   */
  async restoreBuffers(): Promise<void> {
    try {
      const buffers = await rpc.editorBuffer.listBuffers(this.projectId, this.workspaceId);
      for (const { filePath, content } of buffers) {
        const uri = buildMonacoModelPath(this.modelRootPath, filePath);
        const model = modelRegistry.getModelByUri(uri);
        if (model) model.setValue(content);
      }
    } catch (e) {
      log.warn('[FileModelLifecycleStore] Failed to restore buffers:', e);
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  dispose(): void {
    for (const d of this.disposers) d();
  }

  // ---------------------------------------------------------------------------
  // Private — model registration
  // ---------------------------------------------------------------------------

  private async _registerModels(filePath: string): Promise<void> {
    const kind = getFileKind(filePath);

    if (kind === 'image' || kind === 'pdf') {
      const result = await rpc.fs.readImage(this.projectId, this.workspaceId, filePath);
      const imageContent = result.success ? (result.data?.dataUrl ?? '') : '';
      runInAction(() => this.tabManager.setImageContent(filePath, imageContent));
      return;
    }

    if (kind === 'text' || kind === 'markdown' || kind === 'svg') {
      const language = getMonacoLanguageId(filePath);
      try {
        await modelRegistry.registerModel(
          this.projectId,
          this.workspaceId,
          this.modelRootPath,
          filePath,
          language,
          'disk'
        );
      } catch {
        runInAction(() => {
          this.tabManager.updateRenderer(filePath, () => ({ kind: 'file-error' as const }));
        });
        return;
      }

      const bufferUri = buildMonacoModelPath(this.modelRootPath, filePath);
      const diskUri = modelRegistry.toDiskUri(bufferUri);
      if (modelRegistry.modelStatus.get(diskUri) === 'too-large') {
        const totalSize = modelRegistry.modelTotalSizes.get(diskUri);
        runInAction(() => {
          this.tabManager.updateRenderer(filePath, () => ({ kind: 'too-large' as const }));
          if (totalSize != null) this.tabManager.setFileTotalSize(filePath, totalSize);
        });
        return;
      }

      await modelRegistry.registerModel(
        this.projectId,
        this.workspaceId,
        this.modelRootPath,
        filePath,
        language,
        'git'
      );
      await modelRegistry.registerModel(
        this.projectId,
        this.workspaceId,
        this.modelRootPath,
        filePath,
        language,
        'buffer'
      );
    }
  }

  private _unregisterModels(filePath: string): void {
    const uri = buildMonacoModelPath(this.modelRootPath, filePath);
    modelRegistry.unregisterModel(uri);
    modelRegistry.unregisterModel(modelRegistry.toDiskUri(uri));
    modelRegistry.unregisterModel(modelRegistry.toGitUri(uri, HEAD_REF));
    void rpc.editorBuffer.clearBuffer(this.projectId, this.workspaceId, filePath);
  }
}

function formatResultError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return 'Failed to read the file from disk';
}
