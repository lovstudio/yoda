import type { TFunction } from 'i18next';
import {
  Archive,
  CableIcon,
  Copy,
  FolderOpen,
  Info,
  PencilLine,
  Pin,
  PinOff,
  RotateCcw,
  Settings2,
} from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
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

interface ProjectMenuActions {
  isPinned: boolean;
  canPin: boolean;
  isSsh: boolean;
  canReconnect: boolean;
  projectPath?: string;
  onPin: () => void;
  onUnpin: () => void;
  onOpenDetails?: () => void;
  onReconnect?: () => void;
  onChangeSshConnection?: () => void;
  onConfigureScripts?: () => void;
  onRename?: () => void;
  onArchive: () => void;
}

interface MenuItemDescriptor {
  key: string;
  group: number;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  variant?: 'default' | 'destructive';
}

function useMenuItems(actions: ProjectMenuActions): MenuItemDescriptor[] {
  const { t } = useTranslation();
  const items: MenuItemDescriptor[] = [];

  // group 0 — primary navigation
  if (actions.onOpenDetails) {
    items.push({
      key: 'open-details',
      group: 0,
      icon: Info,
      label: t('sidebar.openProjectDetails'),
      onSelect: actions.onOpenDetails,
    });
  }

  // group 1 — path utilities
  if (actions.projectPath) {
    const path = actions.projectPath;
    items.push({
      key: 'copy-project-path',
      group: 1,
      icon: Copy,
      label: t('sidebar.copyProjectPath'),
      onSelect: () => {
        void copyProjectPath(path, t);
      },
    });
    if (!actions.isSsh) {
      items.push({
        key: 'open-project-path',
        group: 1,
        icon: FolderOpen,
        label: t('sidebar.openProjectPath'),
        onSelect: () => {
          void openProjectPath(path, t);
        },
      });
    }
  }

  // group 2 — configuration
  if (actions.canPin) {
    items.push(
      actions.isPinned
        ? {
            key: 'unpin',
            group: 2,
            icon: PinOff,
            label: t('sidebar.unpinProject'),
            onSelect: actions.onUnpin,
          }
        : {
            key: 'pin',
            group: 2,
            icon: Pin,
            label: t('sidebar.pinProject'),
            onSelect: actions.onPin,
          }
    );
  }
  if (actions.onRename) {
    items.push({
      key: 'rename',
      group: 2,
      icon: PencilLine,
      label: t('sidebar.renameProject.menuLabel'),
      onSelect: actions.onRename,
    });
  }
  if (actions.onConfigureScripts) {
    items.push({
      key: 'configure-scripts',
      group: 2,
      icon: Settings2,
      label: t('sidebar.runScripts.configure'),
      onSelect: actions.onConfigureScripts,
    });
  }

  // group 3 — ssh
  if (actions.isSsh) {
    if (actions.onReconnect) {
      items.push({
        key: 'reconnect',
        group: 3,
        icon: RotateCcw,
        label: t('sidebar.reconnect'),
        onSelect: actions.onReconnect,
        disabled: !actions.canReconnect,
      });
    }
    if (actions.onChangeSshConnection) {
      items.push({
        key: 'change-ssh',
        group: 3,
        icon: CableIcon,
        label: t('sidebar.changeSshConnection'),
        onSelect: actions.onChangeSshConnection,
      });
    }
  }

  // group 4 — archive
  items.push({
    key: 'archive',
    group: 4,
    icon: Archive,
    label: t('sidebar.archiveProject'),
    onSelect: actions.onArchive,
  });

  return items;
}

async function copyProjectPath(path: string, t: TFunction) {
  try {
    const res = await rpc.app.clipboardWriteText(path);
    if (!res?.success) throw new Error(res?.error ?? t('common.unknownError'));
    toast({ title: t('sidebar.projectPathCopied') });
  } catch {
    toast({
      title: t('common.copyFailed'),
      description: t('sidebar.copyProjectPathFailed'),
      variant: 'destructive',
    });
  }
}

async function openProjectPath(path: string, t: TFunction) {
  try {
    const res = await rpc.app.openIn({ app: 'finder', path });
    if (!res?.success) throw new Error(res?.error ?? t('common.unknownError'));
  } catch (error) {
    toast({
      title: t('openIn.failed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive',
    });
  }
}

interface ProjectContextMenuProps extends ProjectMenuActions {
  children: React.ReactNode;
}

export function ProjectContextMenu({ children, ...actions }: ProjectContextMenuProps) {
  const items = useMenuItems(actions);
  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {items.map((item, index) => {
          const prev = items[index - 1];
          const showSeparator = prev && prev.group !== item.group;
          const Icon = item.icon;
          return (
            <React.Fragment key={item.key}>
              {showSeparator && <ContextMenuSeparator />}
              <ContextMenuItem
                disabled={item.disabled}
                variant={item.variant}
                onClick={(e) => {
                  e.stopPropagation();
                  item.onSelect();
                }}
              >
                <Icon className="size-4" />
                {item.label}
              </ContextMenuItem>
            </React.Fragment>
          );
        })}
      </ContextMenuContent>
    </ContextMenu>
  );
}

interface ProjectActionsMenuProps extends ProjectMenuActions {
  trigger: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: 'start' | 'center' | 'end';
}

export function ProjectActionsMenu({
  trigger,
  open,
  onOpenChange,
  align = 'end',
  ...actions
}: ProjectActionsMenuProps) {
  const items = useMenuItems(actions);
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent align={align} className="min-w-44">
        {items.map((item, index) => {
          const prev = items[index - 1];
          const showSeparator = prev && prev.group !== item.group;
          const Icon = item.icon;
          return (
            <React.Fragment key={item.key}>
              {showSeparator && <DropdownMenuSeparator />}
              <DropdownMenuItem
                disabled={item.disabled}
                variant={item.variant}
                onClick={(e) => {
                  e.stopPropagation();
                  item.onSelect();
                }}
              >
                <Icon className="size-4" />
                {item.label}
              </DropdownMenuItem>
            </React.Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
