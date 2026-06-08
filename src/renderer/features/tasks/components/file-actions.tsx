import {
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  MoreHorizontal,
  PanelRightOpen,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { cn } from '@renderer/utils/utils';

/**
 * Shared file-action surface for any panel that references a file on disk
 * (context panel, hooks panel, …). Resolves the workspace-relative path and
 * exposes open-in-editor / reveal-in-tree / open-in-finder / copy-path actions,
 * plus a dropdown trigger and a right-click context-menu wrapper.
 */
export function useFileActions(sourcePath: string) {
  const { t } = useTranslation();
  const provisioned = useProvisionedTask();
  const relativePath = toWorkspaceRelativePath(sourcePath, provisioned.path);
  const isRemote = !!provisioned.workspace.sshConnectionId;

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

  return {
    t,
    relativePath,
    isRemote,
    openInEditor,
    revealInFileTree,
    openFile: () => void openFileInFinder(sourcePath, t),
    revealFile: () => void revealFileInFinder(sourcePath, t),
    copyPath: () => void copyFilePathToClipboard(sourcePath, t),
  };
}

export function FileActionsDropdown({
  sourcePath,
  className,
}: {
  sourcePath: string;
  className?: string;
}) {
  const {
    t,
    relativePath,
    isRemote,
    openInEditor,
    revealInFileTree,
    openFile,
    revealFile,
    copyPath,
  } = useFileActions(sourcePath);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              'flex size-5 items-center justify-center rounded-sm text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border',
              className
            )}
            aria-label={t('tasks.panel.fileActions')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-48">
        {relativePath ? (
          <>
            <DropdownMenuItem
              onClick={(event) => {
                event.stopPropagation();
                openInEditor();
              }}
            >
              <FileText className="size-4" />
              {t('tasks.panel.openInEditor')}
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
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem
          disabled={isRemote}
          onClick={(event) => {
            event.stopPropagation();
            openFile();
          }}
        >
          <ExternalLink className="size-4" />
          {t('tasks.panel.openFile')}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isRemote}
          onClick={(event) => {
            event.stopPropagation();
            revealFile();
          }}
        >
          <FolderOpen className="size-4" />
          {t('tasks.panel.revealInFolder')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={(event) => {
            event.stopPropagation();
            copyPath();
          }}
        >
          <Copy className="size-4" />
          {t('tasks.panel.copyFilePath')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
  const {
    t,
    relativePath,
    isRemote,
    openInEditor,
    revealInFileTree,
    openFile,
    revealFile,
    copyPath,
  } = useFileActions(sourcePath);

  return (
    <ContextMenu>
      {mergeTrigger ? (
        <ContextMenuTrigger render={children as React.ReactElement} />
      ) : (
        <ContextMenuTrigger>{children}</ContextMenuTrigger>
      )}
      <ContextMenuContent className="w-48">
        <FileActionsMenuItems
          t={t}
          relativePath={relativePath}
          isRemote={isRemote}
          kind={kind}
          openInEditor={openInEditor}
          revealInFileTree={revealInFileTree}
          openFile={openFile}
          revealFile={revealFile}
          copyPath={copyPath}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * The file-action items rendered inside a `ContextMenuContent`. Exposed so other
 * context menus (e.g. the tab strip) can append the same actions to their own
 * menu instead of nesting a second `ContextMenu`. Drive it with the values
 * returned by {@link useFileActions}.
 */
export function FileActionsMenuItems({
  t,
  relativePath,
  isRemote,
  kind = 'file',
  openInEditor,
  revealInFileTree,
  openFile,
  revealFile,
  copyPath,
}: {
  t: (key: string) => string;
  relativePath: string | null;
  isRemote: boolean;
  kind?: 'file' | 'directory';
  openInEditor: () => void;
  revealInFileTree: () => void;
  openFile: () => void;
  revealFile: () => void;
  copyPath: () => void;
}) {
  return (
    <>
      {relativePath ? (
        <>
          {kind === 'file' ? (
            <ContextMenuItem className="whitespace-nowrap" onClick={openInEditor}>
              <FileText className="size-4" />
              {t('tasks.panel.openInEditor')}
            </ContextMenuItem>
          ) : null}
          <ContextMenuItem className="whitespace-nowrap" onClick={revealInFileTree}>
            <PanelRightOpen className="size-4" />
            {t('tasks.panel.revealInFileTree')}
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      ) : null}
      <ContextMenuItem className="whitespace-nowrap" onClick={openFile} disabled={isRemote}>
        <ExternalLink className="size-4" />
        {t('tasks.panel.openFile')}
      </ContextMenuItem>
      <ContextMenuItem className="whitespace-nowrap" onClick={revealFile} disabled={isRemote}>
        <FolderOpen className="size-4" />
        {t('tasks.panel.revealInFolder')}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem className="whitespace-nowrap" onClick={copyPath}>
        <Copy className="size-4" />
        {t('tasks.panel.copyFilePath')}
      </ContextMenuItem>
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

async function openFileInFinder(path: string, t: (key: string) => string): Promise<void> {
  try {
    const res = await rpc.app.openIn({ app: 'finder', path });
    if (!res?.success) {
      showFileActionFailure(t('tasks.panel.openFileFailed'), res?.error);
    }
  } catch (error) {
    showFileActionFailure(t('tasks.panel.openFileFailed'), stringifyError(error));
  }
}

async function revealFileInFinder(path: string, t: (key: string) => string): Promise<void> {
  try {
    const res = await rpc.app.openIn({ app: 'finder', path, reveal: true });
    if (!res?.success) {
      showFileActionFailure(t('tasks.panel.revealFileFailed'), res?.error);
    }
  } catch (error) {
    showFileActionFailure(t('tasks.panel.revealFileFailed'), stringifyError(error));
  }
}

async function copyFilePathToClipboard(path: string, t: (key: string) => string): Promise<void> {
  try {
    const res = await rpc.app.clipboardWriteText(path);
    if (res?.success) {
      toast({ title: t('tasks.panel.filePathCopied') });
      return;
    }
  } catch {
    // handled below
  }
  toast({
    title: t('common.copyFailed'),
    description: t('tasks.panel.copyFilePathFailed'),
    variant: 'destructive',
  });
}

function showFileActionFailure(title: string, description?: string): void {
  toast({ title, description, variant: 'destructive' });
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
