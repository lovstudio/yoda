import { FileText, FolderTree, PanelRight, PanelRightOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import {
  FilePathActionsDropdown,
  FilePathMenuItems,
  type FilePathTarget,
} from '@renderer/lib/components/file-path-actions';
import { appState } from '@renderer/lib/stores/app-state';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { DropdownMenuItem } from '@renderer/lib/ui/dropdown-menu';

/**
 * Task-scoped file-action surface: composes the context-free path actions
 * (lib/components/file-path-actions) with workspace-bound extras —
 * open-in-editor and reveal-in-file-tree.
 */
export function useFileActions(sourcePath: string) {
  const { t } = useTranslation();
  const provisioned = useProvisionedTask();
  const relativePath = toWorkspaceRelativePath(sourcePath, provisioned.path);
  // Workspace files open by relative path (stable buffer URIs under the
  // workspace model root); anything else — user CLAUDE.md, global skills,
  // transcripts — opens by absolute path, same as the transcript viewer.
  const openablePath = relativePath ?? sourcePath;
  const placement = useTaskFilePlacementActions(openablePath);

  const target: FilePathTarget = {
    absolutePath: sourcePath,
    relativePath,
    sshConnectionId: provisioned.workspace.sshConnectionId ?? null,
  };

  const openInEditor = () => {
    provisioned.taskView.tabManager.openFile(openablePath);
    provisioned.taskView.setFocusedRegion('main');
  };

  // Reveal needs a node in the workspace file tree — outside files have none.
  const revealInFileTree = relativePath
    ? () => {
        provisioned.taskView.setSidebarTab('files');
        provisioned.taskView.setSidebarCollapsed(false);
        void provisioned.workspace.files.revealFile(
          relativePath,
          provisioned.taskView.editorView.expandedPaths
        );
      }
    : null;

  return { t, relativePath, target, openInEditor, revealInFileTree, ...placement };
}

/**
 * Sidebar placement actions for any path the task tab manager can open —
 * workspace-relative or absolute (e.g. transcript JSONLs outside the worktree).
 */
export function useTaskFilePlacementActions(path: string | null | undefined) {
  const provisioned = useProvisionedTask();

  const openInSidebar = () => {
    if (!path) return;
    provisioned.taskView.tabManager.openFileInSidebar(path);
    // Pinning while the sidebar is hidden would silently swallow the tab.
    provisioned.taskView.setSidebarCollapsed(false);
  };

  const openInGlobalSidebar = () => {
    if (!path) return;
    const tabId = provisioned.taskView.tabManager.openFileInShellPin(path);
    appState.sidePane.pinTask(provisioned.projectId, provisioned.taskId, tabId);
  };

  return { openInSidebar, openInGlobalSidebar };
}

export function FileActionsDropdown({
  sourcePath,
  className,
}: {
  sourcePath: string;
  className?: string;
}) {
  const { t, target, openInEditor, openInSidebar, openInGlobalSidebar, revealInFileTree } =
    useFileActions(sourcePath);

  return (
    <FilePathActionsDropdown target={target} className={className}>
      <DropdownMenuItem
        onClick={(event) => {
          event.stopPropagation();
          openInEditor();
        }}
      >
        <FileText className="size-4" />
        {t('fileActions.openInMainArea')}
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={(event) => {
          event.stopPropagation();
          openInSidebar();
        }}
      >
        <PanelRight className="size-4" />
        {t('tasks.tabs.openInSidePane')}
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={(event) => {
          event.stopPropagation();
          openInGlobalSidebar();
        }}
      >
        <PanelRightOpen className="size-4" />
        {t('appTabs.openInGlobalSidePane')}
      </DropdownMenuItem>
      {revealInFileTree ? (
        <DropdownMenuItem
          onClick={(event) => {
            event.stopPropagation();
            revealInFileTree();
          }}
        >
          <FolderTree className="size-4" />
          {t('tasks.panel.revealInFileTree')}
        </DropdownMenuItem>
      ) : null}
    </FilePathActionsDropdown>
  );
}

/**
 * Floating file-actions pill for full-bleed editor views (Monaco hosts),
 * mirroring the markdown preview's top-right toolbar chrome.
 */
export function FileActionsOverlay({ filePath }: { filePath: string }) {
  const provisioned = useProvisionedTask();
  const sourcePath = `${provisioned.path.replace(/\/+$/, '')}/${filePath}`;

  return (
    <div className="absolute right-3 top-3 z-10 flex h-7 items-center overflow-hidden rounded-lg border border-border bg-background">
      <FileActionsDropdown
        sourcePath={sourcePath}
        className="flex h-full w-auto items-center justify-center rounded-none px-2"
      />
    </div>
  );
}

export function FileActionsContextMenu({
  sourcePath,
  kind = 'file',
  mergeTrigger = false,
  children,
}: {
  sourcePath: string;
  /** Hides file-only actions (e.g. open-in-editor) when the target is a directory. */
  kind?: 'file' | 'directory';
  /**
   * Merge the trigger onto the single child element instead of adding a wrapper.
   * Required when the child owns its own layout (e.g. an absolutely-positioned
   * virtualized row); the child must forward props/ref to a DOM element.
   */
  mergeTrigger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <ContextMenu>
      {mergeTrigger ? (
        <ContextMenuTrigger render={children as React.ReactElement} />
      ) : (
        <ContextMenuTrigger>{children}</ContextMenuTrigger>
      )}
      <ContextMenuContent className="w-52">
        <FileActionsMenuItems sourcePath={sourcePath} kind={kind} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * The file-action items rendered inside a `ContextMenuContent`. Exposed so other
 * context menus (e.g. the tab strip) can append the same actions to their own
 * menu instead of nesting a second `ContextMenu`.
 */
export function FileActionsMenuItems({
  sourcePath,
  kind = 'file',
}: {
  sourcePath: string;
  kind?: 'file' | 'directory';
}) {
  const { t, target, openInEditor, openInSidebar, openInGlobalSidebar, revealInFileTree } =
    useFileActions(sourcePath);

  return (
    <>
      {kind === 'file' || revealInFileTree ? (
        <>
          {kind === 'file' ? (
            <>
              <ContextMenuItem className="whitespace-nowrap" onClick={openInEditor}>
                <FileText className="size-4" />
                {t('fileActions.openInMainArea')}
              </ContextMenuItem>
              <ContextMenuItem className="whitespace-nowrap" onClick={openInSidebar}>
                <PanelRight className="size-4" />
                {t('tasks.tabs.openInSidePane')}
              </ContextMenuItem>
              <ContextMenuItem className="whitespace-nowrap" onClick={openInGlobalSidebar}>
                <PanelRightOpen className="size-4" />
                {t('appTabs.openInGlobalSidePane')}
              </ContextMenuItem>
            </>
          ) : null}
          {revealInFileTree ? (
            <ContextMenuItem className="whitespace-nowrap" onClick={revealInFileTree}>
              <FolderTree className="size-4" />
              {t('tasks.panel.revealInFileTree')}
            </ContextMenuItem>
          ) : null}
          <ContextMenuSeparator />
        </>
      ) : null}
      <FilePathMenuItems
        target={target}
        components={{ Item: ContextMenuItem, Separator: ContextMenuSeparator }}
      />
    </>
  );
}

export function toWorkspaceRelativePath(
  sourcePath: string | null | undefined,
  workspaceRoot: string | null | undefined
): string | null {
  const normalizedSource = normalizePathForCompare(sourcePath);
  const normalizedRoot = normalizePathForCompare(workspaceRoot).replace(/\/+$/, '');
  if (!normalizedSource || !normalizedRoot) return null;
  const sourceKey = sourcePathHasDriveLetter(normalizedSource)
    ? normalizedSource.toLowerCase()
    : normalizedSource;
  const rootKey = sourcePathHasDriveLetter(normalizedRoot)
    ? normalizedRoot.toLowerCase()
    : normalizedRoot;
  if (sourceKey === rootKey) return null;
  if (!sourceKey.startsWith(`${rootKey}/`)) return null;
  return normalizedSource.slice(normalizedRoot.length + 1);
}

function normalizePathForCompare(path: string | null | undefined): string {
  if (typeof path !== 'string') return '';
  return path.replace(/\\/g, '/');
}

function sourcePathHasDriveLetter(path: string): boolean {
  return /^[a-z]:\//i.test(path);
}
