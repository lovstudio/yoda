import {
  ClipboardCopy,
  Copy,
  ExternalLink,
  FileText,
  MoreHorizontal,
  PanelRight,
  PanelRightOpen,
  TerminalSquare,
} from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { getAppById, type OpenInRequest } from '@shared/openInApps';
import { openProjectFileTab } from '@renderer/features/project-file/project-file-session';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { toast } from '@renderer/lib/hooks/use-toast';
import { useOpenInApps } from '@renderer/lib/hooks/useOpenInApps';
import { rpc } from '@renderer/lib/ipc';
import { useIsPinHosted } from '@renderer/lib/layout/navigation-provider';
import { appState } from '@renderer/lib/stores/app-state';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { cn } from '@renderer/utils/utils';
import {
  buildFilePathDefaultOpenRequest,
  buildFilePathOpenInRequest,
  type FilePathOpenTarget,
} from './file-path-open';

/**
 * Context-free file actions for any UI that references a path on disk:
 * copy relative/absolute path, open / reveal in the OS file manager, and an
 * SSH-aware terminal fallback. Task-scoped surfaces (open-in-editor,
 * reveal-in-file-tree) compose on top of this — see
 * features/tasks/components/file-actions.tsx.
 */
export type FilePathTarget = FilePathOpenTarget & {
  /** Path relative to the project/workspace root, when one applies. */
  relativePath?: string | null;
};

export function useFilePathActions(target: FilePathTarget) {
  const { t } = useTranslation();
  const isRemote = target.sshConnectionId != null;

  return {
    isRemote,
    copyAbsolutePath: () => void copyPath(target.absolutePath, t),
    copyRelativePath: target.relativePath
      ? () => void copyPath(target.relativePath as string, t)
      : null,
    // Directories have no content to copy.
    copyFileContent:
      target.kind === 'directory'
        ? null
        : () => void copyFileContent(target.absolutePath, target.sshConnectionId ?? null, t),
    openFile: isRemote
      ? () =>
          void openIn(
            {
              app: 'terminal',
              path: target.absolutePath,
              isRemote: true,
              sshConnectionId: target.sshConnectionId ?? null,
            },
            t
          )
      : () => void openIn(buildFilePathDefaultOpenRequest(target), t),
  };
}

/**
 * All visible "Open in" targets — installed and not hidden in Settings →
 * Open in — with the user's default app first. Finder is included as a
 * regular target (reveal for files, open for directories); Terminal is
 * excluded on remote targets (the open-in-terminal item covers it).
 */
function useOpenInTargets(isRemote: boolean) {
  const { icons, labels, installedApps, loading } = useOpenInApps();
  const { value: openInSettings } = useAppSettingsKey('openIn');

  if (loading) return [];
  const defaultId = openInSettings?.default;
  return installedApps
    .filter((app) => !isRemote || (app.supportsRemote && app.id !== 'terminal'))
    .sort((a, b) => (a.id === defaultId ? -1 : b.id === defaultId ? 1 : 0))
    .map((app) => ({
      id: app.id,
      label: labels[app.id] ?? app.label,
      icon: icons[app.id],
      invertInDark: getAppById(app.id)?.invertInDark === true,
    }));
}

type MenuPrimitives = {
  Item: ComponentType<{
    onClick?: (event: React.MouseEvent) => void;
    disabled?: boolean;
    className?: string;
    children?: ReactNode;
  }>;
  Separator: ComponentType<Record<string, never>>;
};

/**
 * The base file-action menu items, rendered through injected menu primitives so
 * both DropdownMenu and ContextMenu surfaces share one implementation.
 *
 * Group structure (placement items are the caller's first group, see
 * GlobalFileMenuItems / features/tasks/components/file-actions.tsx):
 * open-in apps incl. Finder, then copy-path actions.
 */
export function FilePathMenuItems({
  target,
  components: { Item, Separator },
  onAfterAction,
}: {
  target: FilePathTarget;
  components: MenuPrimitives;
  onAfterAction?: () => void;
}) {
  const { t } = useTranslation();
  const actions = useFilePathActions(target);
  const openInTargets = useOpenInTargets(actions.isRemote);

  return (
    <>
      {!actions.isRemote && target.kind !== 'directory' ? (
        <Item
          className="whitespace-nowrap"
          onClick={(event) => {
            event.stopPropagation();
            actions.openFile();
            onAfterAction?.();
          }}
        >
          <ExternalLink className="size-4" />
          {t('tasks.panel.openFile')}
        </Item>
      ) : null}
      {openInTargets.map((app) => (
        <Item
          key={app.id}
          className="whitespace-nowrap"
          onClick={(event) => {
            event.stopPropagation();
            void openIn(buildFilePathOpenInRequest(app.id, target), t);
            onAfterAction?.();
          }}
        >
          {app.icon ? (
            <img
              src={app.icon}
              alt={app.label}
              className={cn('size-4 rounded', app.invertInDark && 'dark:invert')}
            />
          ) : (
            <ExternalLink className="size-4" />
          )}
          {t('fileActions.openInApp', { app: app.label })}
        </Item>
      ))}
      {actions.isRemote ? (
        <Item
          className="whitespace-nowrap"
          onClick={(event) => {
            event.stopPropagation();
            actions.openFile();
            onAfterAction?.();
          }}
        >
          <TerminalSquare className="size-4" />
          {t('fileActions.openInTerminal')}
        </Item>
      ) : null}
      <Separator />
      {actions.copyRelativePath ? (
        <Item
          className="whitespace-nowrap"
          onClick={(event) => {
            event.stopPropagation();
            actions.copyRelativePath?.();
            onAfterAction?.();
          }}
        >
          <Copy className="size-4" />
          {t('fileActions.copyRelativePath')}
        </Item>
      ) : null}
      <Item
        className="whitespace-nowrap"
        onClick={(event) => {
          event.stopPropagation();
          actions.copyAbsolutePath();
          onAfterAction?.();
        }}
      >
        <Copy className="size-4" />
        {t('fileActions.copyAbsolutePath')}
      </Item>
      {actions.copyFileContent ? (
        <Item
          className="whitespace-nowrap"
          onClick={(event) => {
            event.stopPropagation();
            actions.copyFileContent?.();
            onAfterAction?.();
          }}
        >
          <ClipboardCopy className="size-4" />
          {t('fileActions.copyFileContent')}
        </Item>
      ) : null}
    </>
  );
}

/**
 * Dropdown trigger (ellipsis button) with the base file actions. Extra
 * context-specific items can be prepended via `children`; they render above the
 * base items, separated automatically.
 */
export function FilePathActionsDropdown({
  target,
  className,
  children,
  onOpenChangeComplete,
}: {
  target: FilePathTarget;
  className?: string;
  children?: ReactNode;
  /** Fires after the open/close transition settles — used to defer panel-switching actions. */
  onOpenChangeComplete?: (open: boolean) => void;
}) {
  const { t } = useTranslation();

  return (
    <DropdownMenu onOpenChangeComplete={onOpenChangeComplete}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              'flex size-5 items-center justify-center rounded-sm text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border',
              className
            )}
            aria-label={t('fileActions.label')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-52">
        {children ? (
          <>
            {children}
            <DropdownMenuSeparator />
          </>
        ) : null}
        <FilePathMenuItems
          target={target}
          components={{ Item: DropdownMenuItem, Separator: DropdownMenuSeparator }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type GlobalFileSurface = 'main' | 'globalSidePane';

/**
 * The provisioned task currently routed in the main area, if any — the target
 * for "open in (task) sidebar" from global surfaces like a pinned skill view.
 * Evaluated when the menu renders (on open), so no MobX subscription is needed.
 */
function activeRoutedProvisionedTask() {
  if (appState.navigation.currentViewId !== 'task') return null;
  const params = appState.navigation.viewParamsStore['task'] as
    | { projectId?: string; taskId?: string }
    | undefined;
  if (!params?.projectId || !params.taskId) return null;
  return asProvisioned(getTaskStore(params.projectId, params.taskId)) ?? null;
}

/**
 * Full menu for standalone files outside any project/task (agent-home files:
 * SKILL.md, user CLAUDE.md, …), via injected menu primitives so dropdowns,
 * submenus, and context menus share it. Groups: in-app placement (main area /
 * global side pane, the menu's own surface marked as current), then the base
 * path actions.
 */
export function GlobalFileMenuItems({
  absolutePath,
  components,
}: {
  absolutePath: string;
  components: MenuPrimitives;
}) {
  const { t } = useTranslation();
  const { Item, Separator } = components;
  // Detected, not passed in: the same view (e.g. a skill detail) renders both
  // in the routed main area and pinned into the shell side pane.
  const currentSurface: GlobalFileSurface = useIsPinHosted() ? 'globalSidePane' : 'main';
  const placementLabel = (label: string, surface: GlobalFileSurface) =>
    currentSurface === surface ? t('fileActions.currentLabel', { label }) : label;

  return (
    <>
      <Item
        className="whitespace-nowrap"
        onClick={(event) => {
          event.stopPropagation();
          openProjectFileTab(null, absolutePath);
        }}
      >
        <FileText className="size-4" />
        {placementLabel(t('fileActions.openInMainArea'), 'main')}
      </Item>
      {activeRoutedProvisionedTask() ? (
        <Item
          className="whitespace-nowrap"
          onClick={(event) => {
            event.stopPropagation();
            const provisioned = activeRoutedProvisionedTask();
            if (!provisioned) return;
            provisioned.taskView.tabManager.openFileInSidebar(absolutePath);
            // Pinning while the sidebar is hidden would silently swallow the tab.
            provisioned.taskView.setSidebarCollapsed(false);
          }}
        >
          <PanelRight className="size-4" />
          {t('tasks.tabs.openInSidePane')}
        </Item>
      ) : null}
      <Item
        className="whitespace-nowrap"
        onClick={(event) => {
          event.stopPropagation();
          appState.sidePane.pinView('file', { filePath: absolutePath });
        }}
      >
        <PanelRightOpen className="size-4" />
        {placementLabel(t('appTabs.openInGlobalSidePane'), 'globalSidePane')}
      </Item>
      <Separator />
      <FilePathMenuItems target={{ absolutePath, kind: 'file' }} components={components} />
    </>
  );
}

/**
 * Dropdown trigger (ellipsis button) wrapping GlobalFileMenuItems. Task
 * surfaces use features/tasks/components/file-actions instead, which adds the
 * task-sidebar placement on top.
 */
export function GlobalFileActionsDropdown({
  absolutePath,
  className,
}: {
  absolutePath: string;
  className?: string;
}) {
  const { t } = useTranslation();

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
            aria-label={t('fileActions.label')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-52">
        <GlobalFileMenuItems
          absolutePath={absolutePath}
          components={{ Item: DropdownMenuItem, Separator: DropdownMenuSeparator }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

async function copyPath(path: string, t: (key: string) => string): Promise<void> {
  try {
    const res = await rpc.app.clipboardWriteText(path);
    if (res?.success) {
      toast({ title: t('fileActions.pathCopied') });
      return;
    }
  } catch {
    // handled below
  }
  toast({ title: t('common.copyFailed'), variant: 'destructive' });
}

async function copyFileContent(
  absolutePath: string,
  sshConnectionId: string | null,
  t: (key: string) => string
): Promise<void> {
  let failureDescription: string | undefined;
  try {
    const read = await rpc.fs.readAbsoluteFile(absolutePath, { sshConnectionId });
    if (read.success) {
      const written = await rpc.app.clipboardWriteText(read.data.content);
      if (written?.success) {
        toast({
          title: read.data.truncated
            ? t('fileActions.contentCopiedTruncated')
            : t('fileActions.contentCopied'),
        });
        return;
      }
    } else {
      failureDescription = resultErrorMessage(read.error);
    }
  } catch (error) {
    failureDescription = error instanceof Error ? error.message : String(error);
  }
  toast({ title: t('common.copyFailed'), description: failureDescription, variant: 'destructive' });
}

function resultErrorMessage(error: unknown): string | undefined {
  if (error == null) return undefined;
  if (typeof error !== 'object') return String(error);
  const record = error as Record<string, unknown>;
  if (typeof record.message === 'string') return record.message;
  if (typeof record.detail === 'string') return record.detail;
  return undefined;
}

async function openIn(args: OpenInRequest, t: (key: string) => string): Promise<void> {
  try {
    const res = await rpc.app.openIn(args);
    if (!res?.success) {
      toast({
        title: t('fileActions.openFailed'),
        description: res?.error,
        variant: 'destructive',
      });
    }
  } catch (error) {
    toast({
      title: t('fileActions.openFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive',
    });
  }
}
