import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Input } from '@renderer/lib/ui/input';
import { isImeComposing } from '@renderer/utils/ime';

type RenameConversationModalArgs = {
  projectId: string;
  taskId: string;
  conversationId: string;
  currentTitle: string;
};

type Props = BaseModalProps<void> & RenameConversationModalArgs;

export const RenameConversationModal = observer(function RenameConversationModal({
  projectId,
  taskId,
  conversationId,
  currentTitle,
  onSuccess,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(currentTitle);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedTitle = title.trim();
  const isValid = normalizedTitle.length > 0 && normalizedTitle !== currentTitle;

  const handleSubmit = useCallback(async () => {
    if (!isValid || isSubmitting) return;
    const provisioned = asProvisioned(getTaskStore(projectId, taskId));
    if (!provisioned) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await provisioned.conversations.renameConversation(conversationId, normalizedTitle);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('tasks.sessionInfo.renameFailed'));
      setIsSubmitting(false);
    }
  }, [isValid, isSubmitting, projectId, taskId, conversationId, normalizedTitle, onSuccess, t]);

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>{t('tasks.tabs.renameConversation')}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        <Input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !isImeComposing(e)) {
              void handleSubmit();
            }
          }}
          autoFocus
        />
        {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <ConfirmButton onClick={() => void handleSubmit()} disabled={!isValid || isSubmitting}>
          {t('common.rename')}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
