import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_WORKSPACE_NAME_LENGTH, type Workspace } from '@shared/workspaces';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { workspaceStore } from '@renderer/lib/stores/app-state';
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

type Props = BaseModalProps<Workspace>;

/** Prompts for a workspace name and creates it; resolves with the created workspace. */
export function CreateWorkspaceModal({ onSuccess, onClose }: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = value.trim();
  const isValid = trimmed.length > 0 && trimmed.length <= MAX_WORKSPACE_NAME_LENGTH;

  const handleSubmit = useCallback(async () => {
    if (!isValid || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const created = await workspaceStore.createWorkspace(trimmed);
      onSuccess(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('workspaces.createFailed'));
      setIsSubmitting(false);
    }
  }, [isValid, isSubmitting, trimmed, onSuccess, t]);

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>{t('workspaces.create')}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        <FieldGroup>
          <Field>
            <FieldLabel>{t('workspaces.nameLabel')}</FieldLabel>
            <Input
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                  void handleSubmit();
                }
              }}
              maxLength={MAX_WORKSPACE_NAME_LENGTH}
              placeholder={t('workspaces.defaultName')}
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
}
