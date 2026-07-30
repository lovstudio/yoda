import { Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { QuickAction } from '@shared/project-settings';
import { taskNameFromPrompt } from '@shared/task-name';
import { runProjectQuickAction } from '@renderer/features/projects/run-project-quick-action';
import {
  asMounted,
  getProjectSettingsStore,
  getProjectStore,
  getRepositoryStore,
} from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useEffectiveRuntime } from '@renderer/features/tasks/conversations/use-effective-runtime';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
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
import { Textarea } from '@renderer/lib/ui/textarea';

type CaptureProjectAutomationModalArgs = {
  projectId: string;
  projectName: string;
};

type Props = BaseModalProps<void> & CaptureProjectAutomationModalArgs;

const repeatableOperationPrompt =
  'Treat this as a repeatable project operation. Inspect the repository conventions, perform the work, fix any failures you encounter, and finish with concrete verification evidence.';

function genId(): string {
  return crypto.randomUUID();
}

function buildQuickActionPrompt(intent: string): string {
  return [intent.trim(), '', repeatableOperationPrompt].join('\n');
}

export const CaptureProjectAutomationModal = observer(function CaptureProjectAutomationModal({
  projectId,
  projectName,
  onSuccess,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState('');
  const [label, setLabel] = useState('');
  const [labelOverridden, setLabelOverridden] = useState(false);
  const [quickActionId] = useState(() => genId());
  const settingsStore = getProjectSettingsStore(projectId);
  const projectStore = getProjectStore(projectId);
  const mountedProject = asMounted(projectStore);
  const projectData = mountedProject?.data;
  const connectionId = projectData?.type === 'ssh' ? projectData.connectionId : undefined;
  const { value: homeDraft } = useAppSettingsKey('homeDraft');
  const runtimeOverrideValue =
    settingsStore?.settings?.composerDefaults?.runtimeId ?? homeDraft?.runtimeOverride ?? null;
  const ignoreRuntimeOverride = useCallback(() => {}, []);
  const { runtimeId, createDisabled } = useEffectiveRuntime(connectionId, {
    value: runtimeOverrideValue,
    set: ignoreRuntimeOverride,
  });
  const { navigate } = useNavigate();

  useEffect(() => {
    let cancelled = false;
    if (!settingsStore) {
      setError(t('projects.projectNotReady'));
      setLoading(false);
      return;
    }
    setError(null);
    setLoading(true);
    void (async () => {
      await settingsStore.pageData.load();
      if (cancelled) return;
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [settingsStore, t]);

  const suggestedLabel = useMemo(() => taskNameFromPrompt(intent), [intent]);
  const cleanedIntent = intent.trim();
  const hasIntent = cleanedIntent.length > 0;
  const executionUnavailable = !runtimeId || createDisabled;

  useEffect(() => {
    if (labelOverridden) return;
    setLabel(suggestedLabel);
  }, [labelOverridden, suggestedLabel]);

  const handleLabelChange = (next: string) => {
    setLabel(next);
    setLabelOverridden(next.trim().length > 0);
  };

  const saveQuickAction = async (): Promise<QuickAction | null> => {
    const settingsStore = getProjectSettingsStore(projectId);
    const currentSettings = settingsStore?.settings;
    if (!settingsStore || !currentSettings) {
      setError(t('projects.projectNotReady'));
      return null;
    }
    const cleanedLabel =
      label.trim() || suggestedLabel || t('sidebar.captureAutomation.defaultLabel');
    const action: QuickAction = {
      id: quickActionId,
      label: cleanedLabel,
      command: buildQuickActionPrompt(cleanedIntent),
      kind: 'agent',
      sourceIntent: cleanedIntent,
    };
    const currentActions = currentSettings.quickActions ?? [];
    const nextActions = currentActions.some((item) => item.id === action.id)
      ? currentActions.map((item) => (item.id === action.id ? action : item))
      : [...currentActions, action];
    const nextSettings = JSON.parse(
      JSON.stringify({
        ...currentSettings,
        quickActions: nextActions,
      })
    ) as typeof currentSettings;
    const updateRes = await settingsStore.save(nextSettings);
    if (!updateRes.success) {
      setError(t('projects.settings.saveFailed'));
      return null;
    }
    return action;
  };

  const handleSubmit = async () => {
    if (loading || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const project = asMounted(getProjectStore(projectId));
      const repository = getRepositoryStore(projectId);
      if (!project || !repository || !runtimeId || createDisabled) {
        setError(t('sidebar.captureAutomation.executionUnavailable'));
        return;
      }
      if (!cleanedIntent) {
        setError(t('sidebar.captureAutomation.intentRequired'));
        return;
      }

      await Promise.all([repository.localData.load(), repository.remoteData.load()]);
      const defaultBranch = repository.defaultBranch;
      if (!defaultBranch) {
        setError(t('sidebar.captureAutomation.executionUnavailable'));
        return;
      }

      const action = await saveQuickAction();
      if (!action) return;

      try {
        const result = await runProjectQuickAction({
          project,
          action,
          runtimeId,
          defaultBranch,
        });
        if (result.kind !== 'agent') {
          setError(t('sidebar.captureAutomation.savedButExecutionFailed'));
          return;
        }
        onSuccess();
        navigate('task', { projectId, taskId: result.taskId });
      } catch (executionError) {
        setError(
          t('sidebar.captureAutomation.savedButExecutionFailedWithReason', {
            error:
              executionError instanceof Error ? executionError.message : String(executionError),
          })
        );
      }
    } catch (submitError) {
      setError(
        t('sidebar.captureAutomation.submitFailed', {
          error: submitError instanceof Error ? submitError.message : String(submitError),
        })
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('sidebar.captureAutomation.title', { name: projectName })}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="gap-5">
        <FieldGroup className="gap-5">
          <Field>
            <FieldLabel htmlFor="quick-action-intent">
              {t('sidebar.captureAutomation.intentLabel')}
            </FieldLabel>
            <Textarea
              id="quick-action-intent"
              rows={4}
              value={intent}
              onChange={(event) => setIntent(event.currentTarget.value)}
              disabled={loading}
              placeholder={t('sidebar.captureAutomation.intentPlaceholder')}
              autoFocus
            />
            <FieldDescription>{t('sidebar.captureAutomation.intentDescription')}</FieldDescription>
          </Field>

          {hasIntent && executionUnavailable ? (
            <FieldDescription className="text-destructive">
              {t('sidebar.captureAutomation.executionUnavailable')}
            </FieldDescription>
          ) : null}

          {hasIntent ? (
            <Field className="border-t border-border pt-5">
              <FieldLabel htmlFor="quick-action-label">
                {t('sidebar.captureAutomation.actionLabel')}
              </FieldLabel>
              <Input
                id="quick-action-label"
                value={label}
                disabled={loading}
                placeholder={t('sidebar.captureAutomation.actionLabelPlaceholder')}
                onChange={(e) => handleLabelChange(e.target.value)}
              />
            </Field>
          ) : null}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </FieldGroup>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <ConfirmButton
          onClick={() => void handleSubmit()}
          disabled={loading || submitting || !hasIntent || executionUnavailable}
        >
          {submitting ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              {t('sidebar.captureAutomation.savingAndRunning')}
            </>
          ) : (
            t('sidebar.captureAutomation.saveAndRun')
          )}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
