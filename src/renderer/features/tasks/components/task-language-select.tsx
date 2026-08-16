import { useTranslation } from 'react-i18next';
import type { TaskOutputLanguage } from '@shared/project-settings';
import { MicroLabel } from '@renderer/lib/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { cn } from '@renderer/utils/utils';

/**
 * Every language option, including the two that mean "no call": `skip` (never
 * run) and `prompt` (follow the source text, so nothing to translate).
 */
export const TASK_LANGUAGE_OPTIONS: TaskOutputLanguage[] = ['skip', 'app', 'prompt', 'zh-CN', 'en'];

/** Target languages only — for surfaces where a switch owns the on/off state. */
export const TASK_LANGUAGE_OPTIONS_ON: TaskOutputLanguage[] = ['app', 'prompt', 'zh-CN', 'en'];

/**
 * Prompt rewriting has no use for `prompt`: rewriting into the language the
 * prompt is already in is the same as not rewriting, so that value belongs with
 * the off state, not with the targets.
 */
export const PROMPT_REWRITE_LANGUAGE_OPTIONS: TaskOutputLanguage[] = ['app', 'zh-CN', 'en'];

export function taskLanguageLabel(
  t: ReturnType<typeof useTranslation>['t'],
  value: string
): string {
  switch (value) {
    case 'skip':
      return t('settings.tasks.namingLanguageSkip');
    case 'app':
      return t('settings.tasks.namingLanguageApp');
    case 'prompt':
      return t('settings.tasks.namingLanguagePrompt');
    case 'zh-CN':
      return t('settings.tasks.namingLanguageZh');
    case 'en':
      return t('settings.tasks.namingLanguageEn');
    default:
      return value;
  }
}

/**
 * The output-language picker shared by every AI utility that produces text —
 * prompt rewrite, session naming, session summary — so the options and their
 * labels are defined once instead of once per utility.
 */
export function TaskLanguageSelect({
  label,
  value,
  options,
  disabled,
  onValueChange,
  className,
}: {
  label?: string;
  value: TaskOutputLanguage;
  options: TaskOutputLanguage[];
  disabled?: boolean;
  onValueChange: (next: TaskOutputLanguage) => void;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      {label ? <MicroLabel className="text-foreground-passive">{label}</MicroLabel> : null}
      <Select
        value={value}
        onValueChange={(next) => onValueChange(next as TaskOutputLanguage)}
        disabled={disabled}
      >
        <SelectTrigger size="sm" className="h-8 w-full">
          <SelectValue>{() => taskLanguageLabel(t, value)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option} label={taskLanguageLabel(t, option)}>
              {taskLanguageLabel(t, option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
