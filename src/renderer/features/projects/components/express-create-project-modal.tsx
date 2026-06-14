import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getProjectManagerStore } from '@renderer/features/projects/stores/project-selectors';
import { rpc } from '@renderer/lib/ipc';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { isImeComposing } from '@renderer/utils/ime';

type Props = BaseModalProps<string> & {
  /** Prefill for the title input (e.g. the project search query). */
  defaultName?: string;
};

/**
 * Prompts for a project title, then express-creates a git-initialized project
 * under the default projects directory. Resolves with the new project id.
 */
export function ExpressCreateProjectModal({ defaultName = '', onSuccess, onClose }: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState(defaultName);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = value.trim();
  const isValid = trimmed.length > 0;

  const handleSubmit = useCallback(async () => {
    if (!isValid || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const { path, name } = await rpc.projects.prepareQuickProject({ name: trimmed });
      const projectId = await getProjectManagerStore().createProject(
        { type: 'local' },
        { mode: 'pick', name, path, initGitRepository: true }
      );
      if (!projectId) {
        setIsSubmitting(false);
        return;
      }
      onSuccess(projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('projects.failedExpressCreate'));
      setIsSubmitting(false);
    }
  }, [isValid, isSubmitting, trimmed, onSuccess, t]);

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>{t('projects.expressCreate')}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        <FieldGroup>
          <Field>
            <FieldLabel>{t('projects.expressCreateNameLabel')}</FieldLabel>
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
              placeholder={t('projects.expressCreateNamePlaceholder')}
              autoFocus
            />
            <FieldDescription>{t('projects.expressCreateHint')}</FieldDescription>
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
