import { useTranslation } from 'react-i18next';
import { HomeComposer } from '@renderer/app/home-view';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { DialogContentArea, DialogHeader, DialogTitle } from '@renderer/lib/ui/dialog';

/**
 * Hosts the home page's new-task composer in a modal. The composer preselects
 * the current scope's project via navigation state and navigates to the new
 * task on submit; the modal just closes behind it.
 */
export function NewTaskModal({ onClose }: BaseModalProps) {
  const { t } = useTranslation();
  return (
    <div
      data-yoda-surface="new-task-modal"
      data-yoda-composer-modal
      className="flex min-h-0 flex-1 flex-col"
    >
      <DialogHeader>
        <DialogTitle>{t('sidebar.newTask')}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="gap-0">
        <HomeComposer onSubmitted={onClose} />
      </DialogContentArea>
    </div>
  );
}
