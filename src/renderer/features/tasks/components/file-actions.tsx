import { FileText, PanelRightOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import {
  FilePathActionsDropdown,
  FilePathMenuItems,
  type FilePathTarget,
} from '@renderer/lib/components/file-path-actions';
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

  const target: FilePathTarget = {
    absolutePath: sourcePath,
    relativePath,
    sshConnectionId: provisioned.workspace.sshConnectionId ?? null,
  };

  const openInEditor = () => {
    if (!relativePath) return;
    provisioned.taskView.tabManager.openFile(relativePath);
    provisioned.taskView.setFocusedRegion('main');
  };

  const revealInFileTree = () => {
    if (!relativePath) return;
    provisioned.taskView.setSidebarTab('files');
    provisioned.taskView.setSidebarCollapsed(false);
    void provisioned.workspace.files.revealFile(
      relativePath,
      provisioned.taskView.editorView.expandedPaths
    );
  };

  return { t, relativePath, target, openInEditor, revealInFileTree };
}

export function FileActionsDropdown({
  sourcePath,
  className,
}: {
  sourcePath: string;
  className?: string;
}) {
  const { t, relativePath, target, openInEditor, revealInFileTree } = useFileActions(sourcePath);

  return (
    <FilePathActionsDropdown target={target} className={className}>
      {relativePath ? (
        <>
          <DropdownMenuItem
            onClick={(event) => {
              event.stopPropagation();
              openInEditor();
            }}
          >
            <FileText className="size-4" />
            {t('fileActions.openInYoda')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(event) => {
              event.stopPropagation();
              revealInFileTree();
            }}
          >
            <PanelRightOpen className="size-4" />
            {t('tasks.panel.revealInFileTree')}
          </DropdownMenuItem>
        </>
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
  const { t, relativePath, target, openInEditor, revealInFileTree } = useFileActions(sourcePath);

  return (
    <>
      {relativePath ? (
        <>
          {kind === 'file' ? (
            <ContextMenuItem className="whitespace-nowrap" onClick={openInEditor}>
              <FileText className="size-4" />
              {t('fileActions.openInYoda')}
            </ContextMenuItem>
          ) : null}
          <ContextMenuItem className="whitespace-nowrap" onClick={revealInFileTree}>
            <PanelRightOpen className="size-4" />
            {t('tasks.panel.revealInFileTree')}
          </ContextMenuItem>
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
