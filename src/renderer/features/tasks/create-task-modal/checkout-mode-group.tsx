import { useTranslation } from 'react-i18next';
import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { RadioGroup, RadioGroupItem } from '@renderer/lib/ui/radio-group';
import { Switch } from '@renderer/lib/ui/switch';
import { type CheckoutMode } from './use-from-pull-request-mode';

interface CheckoutModeGroupProps {
  value: CheckoutMode;
  onValueChange: (value: CheckoutMode) => void;
  pushBranch: boolean;
  onPushBranchChange: (value: boolean) => void;
  disabled?: boolean;
}

export function CheckoutModeGroup({
  value,
  onValueChange,
  pushBranch,
  onPushBranchChange,
  disabled,
}: CheckoutModeGroupProps) {
  const { t } = useTranslation();
  const createBranchAndWorktree = value === 'new-branch';

  return (
    <div className="flex flex-col gap-2">
      <RadioGroup value={value} onValueChange={(v) => onValueChange(v as CheckoutMode)}>
        <Field orientation="horizontal">
          <RadioGroupItem value="checkout" disabled={disabled} />
          <FieldLabel>{t('tasks.create.checkoutBranchForReview')}</FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <RadioGroupItem value="new-branch" disabled={disabled} />
          <FieldLabel>{t('tasks.create.createTaskBranchAndWorktree')}</FieldLabel>
        </Field>
      </RadioGroup>
      {createBranchAndWorktree && (
        <Field orientation="horizontal">
          <Switch checked={pushBranch} onCheckedChange={onPushBranchChange} disabled={disabled} />
          <FieldLabel>{t('tasks.create.pushBranchToRemote')}</FieldLabel>
        </Field>
      )}
    </div>
  );
}
