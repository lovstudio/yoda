import { observer } from 'mobx-react-lite';
import { INTERNAL_PROJECT_ID } from '@shared/projects';
import {
  ProjectContextSubmenu,
  ProjectDropdownSubmenu,
} from '@renderer/features/sidebar/project-menu';
import { useProjectMenuActions } from '@renderer/features/sidebar/use-project-menu-actions';
import { ContextMenuSeparator } from '@renderer/lib/ui/context-menu';
import { DropdownMenuSeparator } from '@renderer/lib/ui/dropdown-menu';

/**
 * A task's owning project, reachable from the task's own menu as a cascade.
 * Drafts is skipped: it is a pseudo-project, so renaming/archiving/removing it
 * is meaningless.
 *
 * The project's wiring is resolved here rather than threaded through
 * `TaskMenuActions` because that hook runs for every sidebar row, while this
 * component only mounts once a menu is actually open.
 */
export const TaskProjectContextSubmenu = observer(function TaskProjectContextSubmenu({
  projectId,
}: {
  projectId: string;
}) {
  const bundle = useProjectMenuActions(projectId);
  if (projectId === INTERNAL_PROJECT_ID || !bundle) return null;
  return (
    <>
      <ContextMenuSeparator />
      <ProjectContextSubmenu actions={bundle.actions} />
    </>
  );
});

/** Dropdown twin of {@link TaskProjectContextSubmenu}. */
export const TaskProjectDropdownSubmenu = observer(function TaskProjectDropdownSubmenu({
  projectId,
}: {
  projectId: string;
}) {
  const bundle = useProjectMenuActions(projectId);
  if (projectId === INTERNAL_PROJECT_ID || !bundle) return null;
  return (
    <>
      <DropdownMenuSeparator />
      <ProjectDropdownSubmenu actions={bundle.actions} />
    </>
  );
});
