import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ensureUniqueTaskDisplayName,
  liveTransformTaskDisplayName,
  MAX_TASK_NAME_LENGTH,
  normalizeTaskDisplayName,
} from '@shared/task-name';
import { getRepositoryStore } from '@renderer/features/projects/stores/project-selectors';
import { registeredTaskData } from '@renderer/features/tasks/stores/task';
import { getTaskManagerStore } from '@renderer/features/tasks/stores/task-selectors';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { isImeComposing } from '@renderer/utils/ime';

type CreateParentTaskModalArgs = {
  projectId: string;
  taskId: string;
  /** Default name for the new parent — the current task's name. */
  defaultName: string;
};

type Props = BaseModalProps<void> & CreateParentTaskModalArgs;

/**
 * Wraps a task in a fresh session-less grouping parent. The user names the
 * parent (defaulting to the task's own name); on submit we create a
 * no-worktree container task and reparent this task under it. The new parent
 * inherits the task's current parent so the subtree keeps its place. Mirrors
 * the compare-mode group anchor in home-view.tsx.
 */
export const CreateParentTaskModal = observer(function CreateParentTaskModal({
  projectId,
  taskId,
  defaultName,
  onSuccess,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const [name, setName] = useState(defaultName);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedName = normalizeTaskDisplayName(name);
  const isValid = normalizedName.length > 0;

  const handleNameChange = useCallback((value: string) => {
    setName(liveTransformTaskDisplayName(value));
    setError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!isValid) return;
    const taskManager = getTaskManagerStore(projectId);
    const task = taskManager?.tasks.get(taskId);
    const sourceBranch = getRepositoryStore(projectId)?.defaultBranch;
    if (!taskManager || !task || !sourceBranch) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const existingNames = Array.from(taskManager.tasks.values(), (s) => s.data.name);
      const parentId = crypto.randomUUID();
      await taskManager.createTask({
        id: parentId,
        projectId,
        name: ensureUniqueTaskDisplayName(normalizedName, existingNames),
        sourceBranch,
        strategy: { kind: 'no-worktree' },
        parentTaskId: registeredTaskData(task)?.parentTaskId,
      });
      await task.setParentTask(parentId);
      navigate('task', { projectId, taskId: parentId });
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('tasks.createParent.failed'));
      setIsSubmitting(false);
    }
  }, [isValid, projectId, taskId, normalizedName, navigate, onSuccess, t]);

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>{t('tasks.createParent.title')}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        <FieldGroup>
          <Field>
            <FieldLabel>{t('tasks.createParent.label')}</FieldLabel>
            <Input
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isImeComposing(e)) {
                  void handleSubmit();
                }
              }}
              maxLength={MAX_TASK_NAME_LENGTH}
              autoFocus
            />
            {error && <p className="text-xs text-destructive mt-1">{error}</p>}
          </Field>
        </FieldGroup>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <ConfirmButton onClick={() => void handleSubmit()} disabled={!isValid || isSubmitting}>
          {t('common.create')}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
