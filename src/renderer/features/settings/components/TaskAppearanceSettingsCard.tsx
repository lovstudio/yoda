import { Bookmark, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_TASK_APPEARANCE_SETTINGS,
  resolveTaskAppearance,
  type MultiAgentTaskMarker,
  type TaskAppearancePreset,
  type TaskAppearanceSettings,
  type TaskIdleOpacity,
  type TaskMarker,
  type TaskTitleStyle,
} from '@shared/task-appearance';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  taskIdleOpacityClassName,
  taskTitleStyleClassName,
} from '@renderer/features/tasks/task-appearance-classes';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { cn } from '@renderer/utils/utils';
import { ResetToDefaultButton } from './ResetToDefaultButton';

type PresetKind = 'standard' | 'longTerm';

interface SelectOption {
  value: string;
  label: string;
}

export default function TaskAppearanceSettingsCard() {
  const { t } = useTranslation();
  const {
    value: interfaceSettings,
    update,
    isLoading,
    isSaving,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('interface');
  const appearance = interfaceSettings?.taskAppearance ?? DEFAULT_TASK_APPEARANCE_SETTINGS;
  const disabled = isLoading || isSaving;

  const updatePreset = (kind: PresetKind, patch: Partial<TaskAppearancePreset>) => {
    update({
      taskAppearance: {
        ...appearance,
        [kind]: { ...appearance[kind], ...patch },
      },
    });
  };

  const updateMultiAgentMarker = (marker: MultiAgentTaskMarker) => {
    update({
      taskAppearance: {
        ...appearance,
        multiAgent: { marker },
      },
    });
  };

  const titleStyleOptions: SelectOption[] = [
    { value: 'regular', label: t('settings.taskAppearance.titleStyleRegular') },
    { value: 'medium', label: t('settings.taskAppearance.titleStyleMedium') },
    { value: 'italic', label: t('settings.taskAppearance.titleStyleItalic') },
  ];
  const idleOpacityOptions: SelectOption[] = [
    { value: '100', label: t('settings.taskAppearance.opacity100') },
    { value: '85', label: t('settings.taskAppearance.opacity85') },
    { value: '70', label: t('settings.taskAppearance.opacity70') },
    { value: '55', label: t('settings.taskAppearance.opacity55') },
  ];
  const taskMarkerOptions: SelectOption[] = [
    { value: 'none', label: t('settings.taskAppearance.markerNone') },
    { value: 'dot', label: t('settings.taskAppearance.markerDot') },
    { value: 'bookmark', label: t('settings.taskAppearance.markerBookmark') },
  ];
  const multiAgentMarkerOptions: SelectOption[] = [
    { value: 'users', label: t('settings.taskAppearance.markerUsers') },
    { value: 'dot', label: t('settings.taskAppearance.markerDot') },
    { value: 'none', label: t('settings.taskAppearance.markerNone') },
  ];

  return (
    <div data-testid="task-appearance-settings" className="flex flex-col gap-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground">
            {t('settings.taskAppearance.title')}
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-foreground-muted">
            {t('settings.taskAppearance.description')}
          </p>
        </div>
        <ResetToDefaultButton
          visible={isFieldOverridden('taskAppearance')}
          defaultLabel={t('settings.taskAppearance.defaultPreset')}
          onReset={() => resetField('taskAppearance')}
          disabled={disabled}
        />
      </div>

      <p className="text-xs text-foreground-passive">{t('settings.taskAppearance.previewHint')}</p>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <TaskPresetCard
          title={t('settings.taskAppearance.standard')}
          description={t('settings.taskAppearance.standardDescription')}
          sample={t('settings.taskAppearance.standardSample')}
          preset={appearance.standard}
          appearance={appearance}
          kind="standard"
          disabled={disabled}
          titleStyleOptions={titleStyleOptions}
          idleOpacityOptions={idleOpacityOptions}
          markerOptions={taskMarkerOptions}
          onChange={(patch) => updatePreset('standard', patch)}
        />
        <TaskPresetCard
          title={t('settings.taskAppearance.longTerm')}
          description={t('settings.taskAppearance.longTermDescription')}
          sample={t('settings.taskAppearance.longTermSample')}
          preset={appearance.longTerm}
          appearance={appearance}
          kind="longTerm"
          disabled={disabled}
          titleStyleOptions={titleStyleOptions}
          idleOpacityOptions={idleOpacityOptions}
          markerOptions={taskMarkerOptions}
          onChange={(patch) => updatePreset('longTerm', patch)}
        />
        <MultiAgentPresetCard
          appearance={appearance}
          disabled={disabled}
          markerOptions={multiAgentMarkerOptions}
          onChange={updateMultiAgentMarker}
        />
      </div>
    </div>
  );
}

function TaskPresetCard({
  title,
  description,
  sample,
  preset,
  appearance,
  kind,
  disabled,
  titleStyleOptions,
  idleOpacityOptions,
  markerOptions,
  onChange,
}: {
  title: string;
  description: string;
  sample: string;
  preset: TaskAppearancePreset;
  appearance: TaskAppearanceSettings;
  kind: PresetKind;
  disabled: boolean;
  titleStyleOptions: SelectOption[];
  idleOpacityOptions: SelectOption[];
  markerOptions: SelectOption[];
  onChange: (patch: Partial<TaskAppearancePreset>) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="flex min-w-0 flex-col rounded-lg border border-border/60 bg-background-1/55 p-3">
      <h4 className="text-sm font-medium text-foreground">{title}</h4>
      <p className="mt-0.5 min-h-8 text-xs leading-4 text-foreground-passive">{description}</p>
      <TaskAppearancePreview
        className="mt-3"
        appearance={appearance}
        isLongTerm={kind === 'longTerm'}
        isMultiAgent={false}
        sample={sample}
      />
      <div className="mt-4 flex flex-col gap-3">
        <AppearanceSelect
          label={t('settings.taskAppearance.titleStyle')}
          value={preset.titleStyle}
          options={titleStyleOptions}
          disabled={disabled}
          onChange={(value) => onChange({ titleStyle: value as TaskTitleStyle })}
        />
        <AppearanceSelect
          label={t('settings.taskAppearance.idleStrength')}
          value={String(preset.idleOpacity)}
          options={idleOpacityOptions}
          disabled={disabled}
          onChange={(value) => onChange({ idleOpacity: Number(value) as TaskIdleOpacity })}
        />
        <AppearanceSelect
          label={t('settings.taskAppearance.marker')}
          value={preset.marker}
          options={markerOptions}
          disabled={disabled}
          onChange={(value) => onChange({ marker: value as TaskMarker })}
        />
      </div>
    </section>
  );
}

function MultiAgentPresetCard({
  appearance,
  disabled,
  markerOptions,
  onChange,
}: {
  appearance: TaskAppearanceSettings;
  disabled: boolean;
  markerOptions: SelectOption[];
  onChange: (marker: MultiAgentTaskMarker) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="flex min-w-0 flex-col rounded-lg border border-border/60 bg-background-1/55 p-3 md:col-span-2 xl:col-span-1">
      <h4 className="text-sm font-medium text-foreground">
        {t('settings.taskAppearance.multiAgent')}
      </h4>
      <p className="mt-0.5 min-h-8 text-xs leading-4 text-foreground-passive">
        {t('settings.taskAppearance.multiAgentDescription')}
      </p>
      <TaskAppearancePreview
        className="mt-3"
        appearance={appearance}
        isLongTerm={false}
        isMultiAgent
        sample={t('settings.taskAppearance.multiAgentSample')}
      />
      <div className="mt-4">
        <AppearanceSelect
          label={t('settings.taskAppearance.marker')}
          value={appearance.multiAgent.marker}
          options={markerOptions}
          disabled={disabled}
          onChange={(value) => onChange(value as MultiAgentTaskMarker)}
        />
      </div>
    </section>
  );
}

function AppearanceSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-0 items-center justify-between gap-3 text-xs text-foreground-muted">
      <span>{label}</span>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          if (next) onChange(next);
        }}
      >
        <SelectTrigger size="sm" aria-label={label} className="w-28 max-w-[60%] bg-background">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function TaskAppearancePreview({
  appearance,
  isLongTerm,
  isMultiAgent,
  sample,
  className,
}: {
  appearance: TaskAppearanceSettings;
  isLongTerm: boolean;
  isMultiAgent: boolean;
  sample: string;
  className?: string;
}) {
  const resolved = resolveTaskAppearance(appearance, {
    isLongTerm,
    needsReview: false,
    isIdle: true,
    isMultiAgent,
  });
  return (
    <div
      className={cn(
        'flex min-h-10 min-w-0 items-center rounded-md border border-border/50 bg-background px-2 transition-opacity',
        taskIdleOpacityClassName(resolved.idleOpacity),
        className
      )}
    >
      <span className="inline-flex size-6 shrink-0 items-center justify-center text-foreground-tertiary">
        {resolved.marker === 'users' && (
          <Users aria-label={sample} className="size-4 text-amber-700 dark:text-amber-300" />
        )}
        {resolved.marker === 'bookmark' && (
          <Bookmark aria-label={sample} className="size-3.5 fill-current" />
        )}
        {resolved.marker === 'dot' && (
          <span aria-label={sample} className="size-1.5 rounded-full bg-current" />
        )}
      </span>
      <span
        className={cn('min-w-0 truncate text-sm', taskTitleStyleClassName(resolved.titleStyle))}
      >
        {sample}
      </span>
    </div>
  );
}
