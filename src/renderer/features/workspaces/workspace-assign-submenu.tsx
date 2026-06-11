import { FolderInput, Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { ALL_WORKSPACES_ID, DEFAULT_WORKSPACE_ID } from '@shared/workspaces';
import { showModal } from '@renderer/lib/modal/modal-provider';
import { workspaceStore } from '@renderer/lib/stores/app-state';
import {
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@renderer/lib/ui/context-menu';
import {
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@renderer/lib/ui/dropdown-menu';

/** Radio value used for the "default / unassigned" workspace choice. */
const DEFAULT_WORKSPACE_VALUE = ALL_WORKSPACES_ID;

interface WorkspaceAssignSubmenuProps {
  /** Current sidebar workspace assignment (null = default/unassigned). */
  currentWorkspaceId: string | null;
  /** Assign to a workspace, or null to move to the default. */
  onAssign: (workspaceId: string | null) => void;
}

/**
 * Assign the item, then follow it: switch the active workspace to the target
 * so the moved item stays in view. No-op in the "All" view, where the item
 * remains visible anyway.
 */
function assignAndFollow(
  onAssign: (workspaceId: string | null) => void,
  workspaceId: string | null
): void {
  onAssign(workspaceId);
  if (workspaceStore.isFiltering) {
    workspaceStore.setActiveWorkspaceId(workspaceId ?? DEFAULT_WORKSPACE_ID);
  }
}

/** Prompts for a workspace name via modal, then assigns the item to the new workspace. */
function promptCreateWorkspaceAndAssign(onAssign: (workspaceId: string | null) => void): void {
  showModal('createWorkspaceModal', {
    onSuccess: (workspace) => assignAndFollow(onAssign, workspace.id),
  });
}

/**
 * "Move to workspace" submenu shared by project and task menus — radio list of
 * workspaces plus an inline "new workspace" action that creates and assigns in
 * one step. Context-menu variant.
 */
export const WorkspaceAssignContextSubmenu = observer(function WorkspaceAssignContextSubmenu({
  currentWorkspaceId,
  onAssign,
}: WorkspaceAssignSubmenuProps) {
  const { t } = useTranslation();
  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger className="whitespace-nowrap">
          <FolderInput className="size-4" />
          {t('workspaces.moveToWorkspace')}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuRadioGroup value={currentWorkspaceId ?? DEFAULT_WORKSPACE_VALUE}>
            <ContextMenuRadioItem
              value={DEFAULT_WORKSPACE_VALUE}
              onClick={() => assignAndFollow(onAssign, null)}
            >
              {t('workspaces.defaultWorkspace')}
            </ContextMenuRadioItem>
            {workspaceStore.workspaces.map((workspace) => (
              <ContextMenuRadioItem
                key={workspace.id}
                value={workspace.id}
                onClick={() => assignAndFollow(onAssign, workspace.id)}
              >
                {workspace.name}
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => promptCreateWorkspaceAndAssign(onAssign)}>
            <Plus className="size-4" />
            {t('workspaces.create')}
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
    </>
  );
});

/** Dropdown-menu variant of {@link WorkspaceAssignContextSubmenu}. */
export const WorkspaceAssignDropdownSubmenu = observer(function WorkspaceAssignDropdownSubmenu({
  currentWorkspaceId,
  onAssign,
}: WorkspaceAssignSubmenuProps) {
  const { t } = useTranslation();
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="whitespace-nowrap">
          <FolderInput className="size-4" />
          {t('workspaces.moveToWorkspace')}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup value={currentWorkspaceId ?? DEFAULT_WORKSPACE_VALUE}>
            <DropdownMenuRadioItem
              value={DEFAULT_WORKSPACE_VALUE}
              onClick={() => assignAndFollow(onAssign, null)}
            >
              {t('workspaces.defaultWorkspace')}
            </DropdownMenuRadioItem>
            {workspaceStore.workspaces.map((workspace) => (
              <DropdownMenuRadioItem
                key={workspace.id}
                value={workspace.id}
                onClick={() => assignAndFollow(onAssign, workspace.id)}
              >
                {workspace.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => promptCreateWorkspaceAndAssign(onAssign)}>
            <Plus className="size-4" />
            {t('workspaces.create')}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
});
