import { Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ALL_WORKSPACES_ID, DEFAULT_WORKSPACE_ID } from '@shared/workspaces';
import { toast } from '@renderer/lib/hooks/use-toast';
import { workspaceStore } from '@renderer/lib/stores/app-state';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { isImeComposing } from '@renderer/utils/ime';
import { cn } from '@renderer/utils/utils';
import { workspaceTaskCounts, type WorkspaceTaskCounts } from './workspace-task-counts';

/**
 * Current-workspace selector for the sidebar footer. Shows the active workspace
 * name and opens a flat dropdown: workspace choices ("All", default, user
 * workspaces) as a radio group, create, then rename and remove of the active
 * workspace as separate groups. Workspaces scope the pinned list, projects, and
 * projectless tasks shown below.
 */
export const WorkspaceSwitcher = observer(function WorkspaceSwitcher() {
  const { t } = useTranslation();
  const workspaces = workspaceStore.workspaces;
  const activeId = workspaceStore.activeWorkspaceId;
  const activeWorkspace = workspaceStore.activeWorkspace;
  const [renaming, setRenaming] = React.useState(false);

  const currentName =
    activeWorkspace?.name ??
    (activeId === DEFAULT_WORKSPACE_ID ? t('workspaces.defaultTab') : t('workspaces.allTab'));
  const activeCounts = workspaceTaskCounts(activeId);

  async function handleCreate() {
    try {
      const created = await workspaceStore.createWorkspace(t('workspaces.defaultName'));
      workspaceStore.setActiveWorkspaceId(created.id);
      setRenaming(true);
    } catch (error) {
      toast({
        title: t('workspaces.createFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  }

  async function handleRename(name: string) {
    setRenaming(false);
    const trimmed = name.trim();
    if (!activeWorkspace || !trimmed || trimmed === activeWorkspace.name) return;
    try {
      await workspaceStore.renameWorkspace(activeWorkspace.id, trimmed);
    } catch (error) {
      toast({
        title: t('workspaces.renameFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  }

  async function handleDelete() {
    if (!activeWorkspace) return;
    try {
      await workspaceStore.deleteWorkspace(activeWorkspace.id);
    } catch (error) {
      toast({
        title: t('workspaces.removeFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  }

  if (renaming && activeWorkspace) {
    return (
      <WorkspaceNameInput
        initialValue={activeWorkspace.name}
        onSubmit={(name) => void handleRename(name)}
        onCancel={() => setRenaming(false)}
      />
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg pl-3 text-sm text-inherit outline-none',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
        )}
        aria-label={t('workspaces.switch')}
      >
        <Layers className="h-4 w-4 shrink-0" />
        <span className="truncate">{currentName}</span>
        <WorkspaceCounts counts={activeCounts} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="min-w-56">
        <DropdownMenuRadioGroup value={activeId}>
          <WorkspaceChoice
            workspaceId={ALL_WORKSPACES_ID}
            label={t('workspaces.allTab')}
            onSelect={() => workspaceStore.setActiveWorkspaceId(ALL_WORKSPACES_ID)}
          />
          <DropdownMenuSeparator />
          <WorkspaceChoice
            workspaceId={DEFAULT_WORKSPACE_ID}
            label={t('workspaces.defaultTab')}
            onSelect={() => workspaceStore.setActiveWorkspaceId(DEFAULT_WORKSPACE_ID)}
          />
          {workspaces.map((workspace) => (
            <WorkspaceChoice
              key={workspace.id}
              workspaceId={workspace.id}
              label={workspace.name}
              onSelect={() => workspaceStore.setActiveWorkspaceId(workspace.id)}
            />
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void handleCreate()}>
          <Plus className="size-4" />
          {t('workspaces.create')}
        </DropdownMenuItem>
        {activeWorkspace && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setRenaming(true)}>
              <Pencil className="size-4" />
              {t('workspaces.rename')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => void handleDelete()}>
              <Trash2 className="size-4" />
              {t('workspaces.remove')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

const WorkspaceChoice = observer(function WorkspaceChoice({
  workspaceId,
  label,
  onSelect,
}: {
  workspaceId: string;
  label: string;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuRadioItem value={workspaceId} onClick={onSelect}>
      <span className="truncate">{label}</span>
      <WorkspaceCounts counts={workspaceTaskCounts(workspaceId)} className="ml-auto" />
    </DropdownMenuRadioItem>
  );
});

/**
 * Compact attention badge in `(N)` form, shown next to the workspace label:
 * tasks running, awaiting review or unread. Renders nothing when zero.
 */
function WorkspaceCounts({
  counts,
  className,
}: {
  counts: WorkspaceTaskCounts;
  className?: string;
}) {
  const { t } = useTranslation();
  if (counts.attention <= 0) return null;
  return (
    <span
      className={cn('text-xs text-foreground-passive font-mono', className)}
      aria-label={t('workspaces.countsAria', {
        attention: counts.attention,
      })}
    >
      ({counts.attention})
    </span>
  );
}

function WorkspaceNameInput({
  initialValue,
  onSubmit,
  onCancel,
}: {
  initialValue: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = React.useState(initialValue);
  const ref = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onSubmit(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !isImeComposing(e)) onSubmit(value);
        else if (e.key === 'Escape') onCancel();
      }}
      className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    />
  );
}
