import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getTaskManagerStore } from '@renderer/features/tasks/stores/task-selectors';
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

type ArchiveTaskWithNoteModalArgs = {
  projectId: string;
  taskId: string;
  taskName: string;
};

type Props = BaseModalProps<void> & ArchiveTaskWithNoteModalArgs;

const MAX_ARCHIVE_NOTE_LENGTH = 280;

export const ArchiveTaskWithNoteModal = observer(function ArchiveTaskWithNoteModal({
  projectId,
  taskId,
  taskName,
  onSuccess,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const taskManager = getTaskManagerStore(projectId);

  const handleSubmit = useCallback(async () => {
    if (!taskManager) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await taskManager.archiveTask(taskId, note);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('sidebar.archiveTask'));
      setIsSubmitting(false);
    }
  }, [taskManager, taskId, note, onSuccess, t]);

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>{t('tasks.archiveWithNote.title', { name: taskName })}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        <FieldGroup>
          <Field>
            <FieldLabel>{t('tasks.archiveWithNote.label')}</FieldLabel>
            <Input
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                  void handleSubmit();
                }
              }}
              placeholder={t('tasks.archiveWithNote.placeholder')}
              maxLength={MAX_ARCHIVE_NOTE_LENGTH}
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
        <ConfirmButton onClick={() => void handleSubmit()} disabled={isSubmitting}>
          {isSubmitting ? t('tasks.archiveWithNote.archiving') : t('tasks.archiveWithNote.submit')}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
