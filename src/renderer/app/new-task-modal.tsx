import { useTranslation } from 'react-i18next';
import { HomeComposer } from '@renderer/app/home-view';
import { getTaskStore, taskDisplayName } from '@renderer/features/tasks/stores/task-selectors';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { DialogContentArea, DialogHeader, DialogTitle } from '@renderer/lib/ui/dialog';

/**
 * Hosts the home page's new-task composer in a modal. The composer preselects
 * the current scope's project via navigation state, or locks to a supplied
 * parent task, and navigates to the new task on submit; the modal just closes
 * behind it.
 */
export function NewTaskModal({
  onClose,
  parentTask,
}: BaseModalProps & {
  parentTask?: { projectId: string; taskId: string };
}) {
  const { t } = useTranslation();
  const parentName = parentTask
    ? (taskDisplayName(getTaskStore(parentTask.projectId, parentTask.taskId)) ?? parentTask.taskId)
    : undefined;

  return (
    <div
      data-yoda-surface="new-task-modal"
      data-yoda-composer-modal
      className="flex min-h-0 flex-1 flex-col"
    >
      <DialogHeader>
        <DialogTitle>
          {parentTask
            ? t('home.newSubtaskInTaskTitle', { name: parentName })
            : t('sidebar.newTask')}
        </DialogTitle>
      </DialogHeader>
      <DialogContentArea className="gap-0">
        {parentTask ? (
          <HomeComposer submitTarget={{ kind: 'new-task', parentTask }} onSubmitted={onClose} />
        ) : (
          <HomeComposer onSubmitted={onClose} />
        )}
      </DialogContentArea>
    </div>
  );
}
