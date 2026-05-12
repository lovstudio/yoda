import {
  Activity,
  Archive,
  Copy,
  FileText,
  Pencil,
  Pin,
  PinOff,
  PlayCircle,
  RotateCcw,
  Settings2,
  Trash2,
} from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '@renderer/lib/hooks/use-toast';
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

interface TaskMenuActions {
  isPinned: boolean;
  canPin: boolean;
  isArchived: boolean;
  branchName?: string;
  onPin: () => void;
  onUnpin: () => void;
  onRename: () => void;
  onArchive: () => void;
  onArchiveWithNote?: () => void;
  onRestore?: () => void;
  onReconnect?: () => void;
  onDelete: () => void;
  onRunScript?: () => void;
  canRunScript?: boolean;
  onConfigureScripts?: () => void;
  onViewStatus?: () => void;
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

function useMenuItems(actions: TaskMenuActions): MenuItemDescriptor[] {
  const { t } = useTranslation();
  const items: MenuItemDescriptor[] = [];

  // group 1 — run scripts
  if (actions.onRunScript) {
    items.push({
      key: 'run-script',
      group: 1,
      icon: PlayCircle,
      label: t('sidebar.runScripts.runScript'),
      onSelect: actions.onRunScript,
      disabled: actions.canRunScript === false,
    });
  }
  if (actions.onViewStatus) {
    items.push({
      key: 'view-status',
      group: 1,
      icon: Activity,
      label: t('sidebar.runScripts.scriptStatus'),
      onSelect: actions.onViewStatus,
    });
  }
  if (actions.onConfigureScripts) {
    items.push({
      key: 'configure-scripts',
      group: 1,
      icon: Settings2,
      label: t('sidebar.runScripts.configure'),
      onSelect: actions.onConfigureScripts,
    });
  }

  // group 2 — task management
  if (actions.canPin) {
    items.push(
      actions.isPinned
        ? {
            key: 'unpin',
            group: 2,
            icon: PinOff,
            label: 'Unpin task',
            onSelect: actions.onUnpin,
          }
        : { key: 'pin', group: 2, icon: Pin, label: 'Pin task', onSelect: actions.onPin }
    );
  }
  items.push({
    key: 'rename',
    group: 2,
    icon: Pencil,
    label: 'Rename',
    onSelect: actions.onRename,
  });
  if (actions.onReconnect) {
    items.push({
      key: 'reconnect',
      group: 2,
      icon: RotateCcw,
      label: 'Reconnect',
      onSelect: actions.onReconnect,
    });
  }

  // group 3 — archive / restore
  if (!actions.isArchived) {
    items.push({
      key: 'archive',
      group: 3,
      icon: Archive,
      label: t('sidebar.archiveTask'),
      onSelect: actions.onArchive,
    });
    if (actions.onArchiveWithNote) {
      items.push({
        key: 'archive-with-note',
        group: 3,
        icon: FileText,
        label: t('sidebar.archiveTaskWithNote'),
        onSelect: actions.onArchiveWithNote,
      });
    }
  }
  if (actions.isArchived && actions.onRestore) {
    items.push({
      key: 'restore',
      group: 3,
      icon: RotateCcw,
      label: 'Restore',
      onSelect: actions.onRestore,
    });
  }

  // group 4 — utilities
  if (actions.branchName) {
    const branch = actions.branchName;
    items.push({
      key: 'copy-branch',
      group: 4,
      icon: Copy,
      label: 'Copy branch name',
      onSelect: () => {
        void copyBranchName(branch);
      },
    });
  }

  // group 5 — destructive
  items.push({
    key: 'delete',
    group: 5,
    icon: Trash2,
    label: 'Delete',
    onSelect: actions.onDelete,
    variant: 'destructive',
  });

  return items;
}

async function copyBranchName(branchName: string) {
  try {
    await navigator.clipboard.writeText(branchName);
    toast({ title: 'Branch name copied' });
  } catch {
    toast({
      title: 'Copy failed',
      description: 'The branch name could not be copied to the clipboard.',
      variant: 'destructive',
    });
  }
}

interface TaskContextMenuProps extends TaskMenuActions {
  children: React.ReactNode;
}

export function TaskContextMenu({ children, ...actions }: TaskContextMenuProps) {
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

interface TaskActionsMenuProps extends TaskMenuActions {
  trigger: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: 'start' | 'center' | 'end';
}

export function TaskActionsMenu({
  trigger,
  open,
  onOpenChange,
  align = 'end',
  ...actions
}: TaskActionsMenuProps) {
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
