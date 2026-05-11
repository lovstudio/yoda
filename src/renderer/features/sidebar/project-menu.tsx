import { CableIcon, RotateCcw, Settings2, Trash2 } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
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
  isSsh: boolean;
  canReconnect: boolean;
  onReconnect?: () => void;
  onChangeSshConnection?: () => void;
  onConfigureScripts?: () => void;
  onRemove: () => void;
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

  // group 1 — configuration
  if (actions.onConfigureScripts) {
    items.push({
      key: 'configure-scripts',
      group: 1,
      icon: Settings2,
      label: t('sidebar.runScripts.configure'),
      onSelect: actions.onConfigureScripts,
    });
  }

  // group 2 — ssh
  if (actions.isSsh) {
    if (actions.onReconnect) {
      items.push({
        key: 'reconnect',
        group: 2,
        icon: RotateCcw,
        label: t('sidebar.reconnect'),
        onSelect: actions.onReconnect,
        disabled: !actions.canReconnect,
      });
    }
    if (actions.onChangeSshConnection) {
      items.push({
        key: 'change-ssh',
        group: 2,
        icon: CableIcon,
        label: t('sidebar.changeSshConnection'),
        onSelect: actions.onChangeSshConnection,
      });
    }
  }

  // group 3 — destructive
  items.push({
    key: 'remove',
    group: 3,
    icon: Trash2,
    label: t('sidebar.removeProject'),
    onSelect: actions.onRemove,
    variant: 'destructive',
  });

  return items;
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
                onClick={item.onSelect}
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
                onClick={item.onSelect}
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
