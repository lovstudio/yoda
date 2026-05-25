import { useTranslation } from 'react-i18next';
import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { type TaskNameState } from './use-task-name';

interface TaskNameFieldProps {
  state: TaskNameState;
}

export function TaskNameField({ state }: TaskNameFieldProps) {
  const { t } = useTranslation();
  const { taskName, handleTaskNameChange, branchSlugPreview } = state;

  return (
    <Field>
      <FieldLabel>{t('tasks.rename.label')}</FieldLabel>
      <Input
        data-autofocus
        value={taskName}
        onChange={(e) => handleTaskNameChange(e.target.value)}
      />
      {branchSlugPreview && (
        <p className="text-xs text-muted-foreground mt-1">
          {t('tasks.rename.branchPreview', { slug: branchSlugPreview })}
        </p>
      )}
    </Field>
  );
}
