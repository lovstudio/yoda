import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_PROJECT_ALIAS_LENGTH } from '@shared/projects';
import {
  getProjectManagerStore,
  getProjectStore,
} from '@renderer/features/projects/stores/project-selectors';
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

type RenameProjectModalArgs = {
  projectId: string;
};

export type RenameProjectResult = {
  alias: string | null;
};

type Props = BaseModalProps<RenameProjectResult> & RenameProjectModalArgs;

export const RenameProjectModal = observer(function RenameProjectModal({
  projectId,
  onSuccess,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const project = getProjectStore(projectId);
  const baseName = project?.name ?? '';
  const currentAlias = project?.alias ?? '';

  const [value, setValue] = useState(currentAlias);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = value.trim();
  const isUnchanged = trimmed === currentAlias.trim();
  const tooLong = trimmed.length > MAX_PROJECT_ALIAS_LENGTH;
  const matchesName = trimmed.length > 0 && trimmed === baseName;
  const isValid = !isUnchanged && !tooLong && !matchesName;

  const validationMessage = tooLong
    ? t('sidebar.renameProject.tooLong', { max: MAX_PROJECT_ALIAS_LENGTH })
    : matchesName
      ? t('sidebar.renameProject.matchesName')
      : undefined;

  const handleSubmit = useCallback(async () => {
    if (!isValid) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const alias = trimmed.length > 0 ? trimmed : null;
      await getProjectManagerStore().updateProjectAlias(projectId, alias);
      onSuccess({ alias });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('sidebar.renameProject.failed'));
      setIsSubmitting(false);
    }
  }, [isValid, projectId, trimmed, onSuccess, t]);

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>{t('sidebar.renameProject.title')}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        <FieldGroup>
          <Field>
            <FieldLabel>{t('sidebar.renameProject.label')}</FieldLabel>
            <Input
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isImeComposing(e)) {
                  void handleSubmit();
                }
              }}
              maxLength={MAX_PROJECT_ALIAS_LENGTH}
              placeholder={baseName}
              autoFocus
            />
            <p className="text-xs text-muted-foreground mt-1">
              {t('sidebar.renameProject.hint', { name: baseName })}
            </p>
            {validationMessage && (
              <p className="text-xs text-destructive mt-1">{validationMessage}</p>
            )}
            {error && <p className="text-xs text-destructive mt-1">{error}</p>}
          </Field>
        </FieldGroup>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <ConfirmButton onClick={() => void handleSubmit()} disabled={!isValid || isSubmitting}>
          {isSubmitting ? t('sidebar.renameProject.saving') : t('sidebar.renameProject.submit')}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
