import { useTranslation } from 'react-i18next';
import { HomeComposer, type HomeComposerSubmitResult } from '@renderer/app/home-view';
import { getTaskStore, taskDisplayName } from '@renderer/features/tasks/stores/task-selectors';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { DialogContentArea, DialogHeader, DialogTitle } from '@renderer/lib/ui/dialog';

export type NewConversationModalResult = Extract<
  HomeComposerSubmitResult,
  { kind: 'conversation' }
>;

export function NewConversationModal({
  onSuccess,
  projectId,
  taskId,
}: BaseModalProps<NewConversationModalResult> & {
  projectId: string;
  taskId: string;
}) {
  const { t } = useTranslation();
  const taskName = taskDisplayName(getTaskStore(projectId, taskId)) ?? taskId;
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('home.newConversationInTaskTitle', { name: taskName })}</DialogTitle>
      </DialogHeader>
      <DialogContentArea>
        <HomeComposer
          submitTarget={{ kind: 'existing-task', projectId, taskId }}
          onSubmitted={(result) => {
            if (result.kind === 'conversation') onSuccess(result);
          }}
        />
      </DialogContentArea>
    </>
  );
}
