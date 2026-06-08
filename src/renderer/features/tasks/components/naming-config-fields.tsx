import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { Input } from '@renderer/lib/ui/input';
import { MicroLabel } from '@renderer/lib/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { cn } from '@renderer/utils/utils';

const CONTEXT_KEYS = ['prompt', 'project', 'readme', 'recentTasks'] as const;

/**
 * Shared task-naming configuration controls (model override, target language,
 * context sources). Rendered both in the Tasks settings tab and inline in the
 * task rename panel so the two surfaces stay aligned by construction.
 */
export const NamingConfigFields = observer(function NamingConfigFields({
  className,
  compact,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const taskSettings = useTaskSettings();
  const disabled = taskSettings.loading || taskSettings.saving || !taskSettings.autoGenerateName;

  const contextLabels: Record<(typeof CONTEXT_KEYS)[number], string> = {
    prompt: t('settings.tasks.namingContextPrompt'),
    project: t('settings.tasks.namingContextProject'),
    readme: t('settings.tasks.namingContextReadme'),
    recentTasks: t('settings.tasks.namingContextRecentTasks'),
  };

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div className={cn('flex min-w-0 gap-2', compact ? 'flex-col' : 'flex-wrap items-end')}>
        <Field label={t('settings.tasks.namingSettings')} className="min-w-0 flex-1">
          <Input
            key={taskSettings.namingModel}
            defaultValue={taskSettings.namingModel}
            disabled={disabled}
            placeholder={t('settings.tasks.namingModelPlaceholder')}
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (next !== taskSettings.namingModel) taskSettings.updateNamingModel(next);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            className="h-8 w-full"
          />
        </Field>
        <Field
          label={t('settings.tasks.namingLanguageLabel')}
          className={compact ? 'min-w-0' : 'w-44 shrink-0'}
        >
          <Select
            value={taskSettings.namingLanguage}
            onValueChange={(value) =>
              taskSettings.updateNamingLanguage(value as typeof taskSettings.namingLanguage)
            }
            disabled={disabled}
          >
            <SelectTrigger size="sm" className="h-8 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="app">{t('settings.tasks.namingLanguageApp')}</SelectItem>
              <SelectItem value="prompt">{t('settings.tasks.namingLanguagePrompt')}</SelectItem>
              <SelectItem value="zh-CN">{t('settings.tasks.namingLanguageZh')}</SelectItem>
              <SelectItem value="en">{t('settings.tasks.namingLanguageEn')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <MicroLabel className="text-foreground-passive">
          {t('settings.tasks.namingContextLabel')}
        </MicroLabel>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-foreground-muted">
          {CONTEXT_KEYS.map((key) => (
            <label key={key} className="flex min-w-0 items-center gap-2">
              <Checkbox
                checked={taskSettings.namingContext[key]}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  taskSettings.updateNamingContext({ [key]: checked === true })
                }
              />
              <span className="truncate">{contextLabels[key]}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
});

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <MicroLabel className="text-foreground-passive">{label}</MicroLabel>
      {children}
    </div>
  );
}
