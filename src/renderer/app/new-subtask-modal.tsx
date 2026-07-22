import { Check, ListPlus, Search } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ensureUniqueTaskDisplayName,
  liveTransformTaskDisplayName,
  MAX_TASK_NAME_LENGTH,
  normalizeTaskDisplayName,
} from '@shared/task-name';
import { getRepositoryStore } from '@renderer/features/projects/stores/project-selectors';
import { registeredTaskData, type TaskStore } from '@renderer/features/tasks/stores/task';
import {
  getTaskManagerStore,
  isTaskDescendantOf,
} from '@renderer/features/tasks/stores/task-selectors';
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
import { cn } from '@renderer/utils/utils';

/**
 * Adds a child to a task without starting an agent session. The child can be
 * an existing task from the same project or a fresh session-less grouping
 * task. The main process validates the hierarchy again when an existing task
 * is re-parented.
 */
export const NewSubtaskModal = observer(function NewSubtaskModal({
  onSuccess,
  onClose,
  projectId,
  parentTaskId,
}: BaseModalProps<void> & {
  projectId: string;
  parentTaskId: string;
}) {
  const { t } = useTranslation();
  const taskManager = getTaskManagerStore(projectId);
  const [query, setQuery] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [newTaskName, setNewTaskName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(() => {
    const result: TaskStore[] = [];
    for (const store of taskManager?.tasks.values() ?? []) {
      const data = registeredTaskData(store);
      if (!data || data.id === parentTaskId || data.archivedAt) continue;
      if (data.parentTaskId === parentTaskId) continue;
      if (isTaskDescendantOf(projectId, parentTaskId, data.id)) continue;
      result.push(store);
    }
    return result;
  }, [taskManager, projectId, parentTaskId]);

  const filteredCandidates = query.trim()
    ? candidates.filter((store) =>
        store.data.name.toLowerCase().includes(query.trim().toLowerCase())
      )
    : candidates;
  const normalizedNewTaskName = normalizeTaskDisplayName(newTaskName);
  const canSubmit = selectedTaskId !== null || normalizedNewTaskName.length > 0;

  const handleSubmit = useCallback(async () => {
    if (!taskManager || !canSubmit) return;
    setIsSubmitting(true);
    setError(null);
    try {
      if (selectedTaskId) {
        const child = taskManager.tasks.get(selectedTaskId);
        if (!child) throw new Error(t('tasks.addSubtask.failed'));
        const result = await child.setParentTask(parentTaskId);
        if (result && !result.success) {
          throw new Error(t('tasks.addSubtask.failed'));
        }
      } else {
        const sourceBranch = getRepositoryStore(projectId)?.defaultBranch;
        if (!sourceBranch) throw new Error(t('tasks.addSubtask.failed'));
        const existingNames = Array.from(taskManager.tasks.values(), (store) => store.data.name);
        await taskManager.createTask({
          id: crypto.randomUUID(),
          projectId,
          name: ensureUniqueTaskDisplayName(normalizedNewTaskName, existingNames),
          sourceBranch,
          strategy: { kind: 'no-worktree' },
          parentTaskId,
        });
      }
      onSuccess();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error ? submissionError.message : t('tasks.addSubtask.failed')
      );
      setIsSubmitting(false);
    }
  }, [
    taskManager,
    canSubmit,
    selectedTaskId,
    parentTaskId,
    projectId,
    normalizedNewTaskName,
    onSuccess,
    t,
  ]);

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>{t('tasks.addSubtask.title')}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="gap-4 pt-0">
        <FieldGroup>
          <Field>
            <FieldLabel>{t('tasks.addSubtask.existingLabel')}</FieldLabel>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('tasks.addSubtask.searchPlaceholder')}
                autoFocus
              />
            </div>
            <div className="max-h-52 overflow-y-auto rounded-md border border-border">
              {filteredCandidates.map((store) => (
                <button
                  key={store.data.id}
                  type="button"
                  onClick={() => {
                    setSelectedTaskId(store.data.id);
                    setNewTaskName('');
                    setError(null);
                  }}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-background-tertiary-1',
                    selectedTaskId === store.data.id && 'bg-background-tertiary-1'
                  )}
                >
                  <span className="min-w-0 truncate">{store.data.name}</span>
                  {selectedTaskId === store.data.id && <Check className="size-3.5 shrink-0" />}
                </button>
              ))}
              {filteredCandidates.length === 0 && (
                <div className="px-3 py-2 text-sm text-muted-foreground">
                  {t('tasks.addSubtask.noResults')}
                </div>
              )}
            </div>
          </Field>
          <Field>
            <FieldLabel>{t('tasks.addSubtask.newLabel')}</FieldLabel>
            <Input
              value={newTaskName}
              onChange={(event) => {
                setNewTaskName(liveTransformTaskDisplayName(event.target.value));
                setSelectedTaskId(null);
                setError(null);
              }}
              placeholder={t('tasks.addSubtask.newPlaceholder')}
              maxLength={MAX_TASK_NAME_LENGTH}
            />
          </Field>
        </FieldGroup>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <ConfirmButton onClick={() => void handleSubmit()} disabled={!canSubmit || isSubmitting}>
          <ListPlus className="size-4" />
          {selectedTaskId ? t('tasks.addSubtask.addExisting') : t('tasks.addSubtask.createAndAdd')}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
