import { useTranslation } from 'react-i18next';
import { HomeComposer } from '@renderer/app/home-view';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { DialogContentArea, DialogHeader, DialogTitle } from '@renderer/lib/ui/dialog';

/**
 * Hosts the home page's new-task composer in a modal, so starting new work
 * from inside a task doesn't shift attention away. The composer preselects
 * the current scope's project via navigation state and navigates to the new
 * task on submit; the modal just closes behind it.
 */
export function NewTaskModal({ onClose }: BaseModalProps) {
  const { t } = useTranslation();
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('sidebar.newTask')}</DialogTitle>
      </DialogHeader>
      <DialogContentArea>
        <HomeComposer onSubmitted={onClose} />
      </DialogContentArea>
    </>
  );
}
