import type { SearchItem } from '@shared/search';
import { openTaskTarget } from '@renderer/app/open-task-target';
import { prepareExplicitTaskOpen } from '@renderer/app/prepare-explicit-task-open';
import type { NavigateFnTyped } from '@renderer/lib/layout/navigation-provider';

/** Mounts and reconciles a DB-backed search target before opening it. */
export async function openCommandPaletteSearchTarget(
  item: SearchItem,
  navigate: NavigateFnTyped
): Promise<void> {
  if (item.kind !== 'task' && item.kind !== 'conversation') {
    throw new Error(`Unsupported search target: ${item.kind}`);
  }
  const projectId = item.projectId;
  const taskId = item.kind === 'task' ? item.id : item.taskId;
  if (!projectId || !taskId) throw new Error('Search target is missing its project or task');

  await prepareExplicitTaskOpen(projectId, taskId);

  openTaskTarget(
    {
      projectId,
      taskId,
      ...(item.kind === 'conversation' ? { conversationId: item.id } : {}),
    },
    navigate
  );
}
