import { Loader2, WandSparkles } from 'lucide-react';
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
import { rpc } from '@renderer/lib/ipc';
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
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';

type CaptureProjectAutomationModalArgs = {
  projectId: string;
  projectName: string;
};

type Props = BaseModalProps<void> & CaptureProjectAutomationModalArgs;
type InputMode = 'describe' | 'command';

function genId(): string {
  return crypto.randomUUID();
}

export const CaptureProjectAutomationModal = observer(function CaptureProjectAutomationModal({
  projectId,
  projectName,
  onSuccess,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const [loading, setLoading] = useState(true);
  const [compiling, setCompiling] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<InputMode>('describe');
  const [intent, setIntent] = useState('');
  const [command, setCommand] = useState('');
  const [compiledIntent, setCompiledIntent] = useState<string | null>(null);
  const [explanation, setExplanation] = useState('');
  const [label, setLabel] = useState('');
  const [labelOverridden, setLabelOverridden] = useState(false);
  const [quickActionId] = useState(() => genId());
  const settingsStore = getProjectSettingsStore(projectId);
  const mountedProject = asMounted(getProjectStore(projectId));
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

  const cleanedIntent = intent.trim();
  const cleanedCommand = command.trim();
  const hasIntent = cleanedIntent.length > 0;
  const hasCommand = cleanedCommand.length > 0;
  const hasCurrentGeneratedCommand = compiledIntent === cleanedIntent && hasIntent && hasCommand;
  const isLocalProject = projectData?.type === 'local';
  const runtimeCanCompile = runtimeId === 'codex' || runtimeId === 'claude';
  const compilationUnavailable = !isLocalProject || !runtimeCanCompile || createDisabled;
  const commandSource = inputMode === 'describe' ? cleanedIntent : cleanedCommand;
  const suggestedLabel = useMemo(() => taskNameFromPrompt(commandSource), [commandSource]);
  const showCommandField = inputMode === 'command' || compiledIntent !== null;
  const commandNeedsRefresh =
    inputMode === 'describe' && compiledIntent !== null && compiledIntent !== cleanedIntent;

  useEffect(() => {
    if (labelOverridden) return;
    setLabel(suggestedLabel);
  }, [labelOverridden, suggestedLabel]);

  const handleLabelChange = (next: string) => {
    setLabel(next);
    setLabelOverridden(next.trim().length > 0);
  };

  const handleCompile = async () => {
    if (!hasIntent) {
      setError(t('sidebar.captureAutomation.intentRequired'));
      return;
    }
    if (!runtimeId || compilationUnavailable) {
      setError(t('sidebar.captureAutomation.compilationUnavailable'));
      return;
    }
    setCompiling(true);
    setError(null);
    try {
      const result = await rpc.quickActions.compile({
        projectId,
        intent: cleanedIntent,
        runtimeId,
      });
      setCommand(result.command);
      setExplanation(result.explanation);
      setCompiledIntent(cleanedIntent);
      if (!labelOverridden) setLabel(result.label);
    } catch (compileError) {
      setError(
        t('sidebar.captureAutomation.compileFailed', {
          error: compileError instanceof Error ? compileError.message : String(compileError),
        })
      );
    } finally {
      setCompiling(false);
    }
  };

  const saveQuickAction = async (): Promise<QuickAction | null> => {
    const currentSettings = settingsStore?.settings;
    if (!settingsStore || !currentSettings) {
      setError(t('projects.projectNotReady'));
      return null;
    }
    if (!cleanedCommand) {
      setError(t('sidebar.captureAutomation.commandRequired'));
      return null;
    }
    const cleanedLabel =
      label.trim() || suggestedLabel || t('sidebar.captureAutomation.defaultLabel');
    const action: QuickAction = {
      id: quickActionId,
      label: cleanedLabel,
      command: cleanedCommand,
      kind: 'shell',
      ...(inputMode === 'describe' && cleanedIntent ? { sourceIntent: cleanedIntent } : {}),
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
      if (!project || project.data.type !== 'local') {
        setError(t('sidebar.captureAutomation.executionUnavailable'));
        return;
      }
      if (!cleanedCommand) {
        setError(t('sidebar.captureAutomation.commandRequired'));
        return;
      }
      if (inputMode === 'describe' && !hasCurrentGeneratedCommand) {
        setError(t('sidebar.captureAutomation.generateBeforeSave'));
        return;
      }

      const action = await saveQuickAction();
      if (!action) return;

      try {
        const repository = getRepositoryStore(projectId);
        await Promise.all([repository?.localData.load(), repository?.remoteData.load()]);
        const result = await runProjectQuickAction({
          project,
          action,
          defaultBranch: repository?.defaultBranch,
        });
        if (result.kind !== 'shell') {
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

  const handlePrimaryAction = async () => {
    if (inputMode === 'describe' && !hasCurrentGeneratedCommand) {
      await handleCompile();
      return;
    }
    await handleSubmit();
  };

  const primaryDisabled =
    loading ||
    compiling ||
    submitting ||
    (inputMode === 'describe'
      ? hasCurrentGeneratedCommand
        ? !isLocalProject
        : !hasIntent || compilationUnavailable
      : !hasCommand || !isLocalProject);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('sidebar.captureAutomation.title', { name: projectName })}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="gap-5">
        <FieldGroup className="gap-5">
          <Field>
            <FieldLabel>{t('sidebar.captureAutomation.inputModeLabel')}</FieldLabel>
            <ToggleGroup
              className="w-full"
              aria-label={t('sidebar.captureAutomation.inputModeLabel')}
              value={[inputMode]}
              onValueChange={([value]) => {
                if (!value) return;
                setInputMode(value as InputMode);
                setError(null);
              }}
            >
              <ToggleGroupItem value="describe" className="flex-1">
                {t('sidebar.captureAutomation.describeMode')}
              </ToggleGroupItem>
              <ToggleGroupItem value="command" className="flex-1">
                {t('sidebar.captureAutomation.commandMode')}
              </ToggleGroupItem>
            </ToggleGroup>
          </Field>

          {inputMode === 'describe' ? (
            <Field>
              <FieldLabel htmlFor="quick-action-intent">
                {t('sidebar.captureAutomation.intentLabel')}
              </FieldLabel>
              <Textarea
                id="quick-action-intent"
                rows={4}
                value={intent}
                onChange={(event) => setIntent(event.currentTarget.value)}
                disabled={loading || compiling}
                placeholder={t('sidebar.captureAutomation.intentPlaceholder')}
                autoFocus
              />
              <FieldDescription>
                {t('sidebar.captureAutomation.intentDescription')}
              </FieldDescription>
              {hasIntent && compilationUnavailable && !hasCurrentGeneratedCommand ? (
                <FieldDescription className="text-destructive">
                  {t('sidebar.captureAutomation.compilationUnavailable')}
                </FieldDescription>
              ) : null}
            </Field>
          ) : null}

          {showCommandField ? (
            <Field>
              <FieldLabel htmlFor="quick-action-command">
                {t(
                  inputMode === 'describe'
                    ? 'sidebar.captureAutomation.generatedCommandLabel'
                    : 'sidebar.captureAutomation.directCommandLabel'
                )}
              </FieldLabel>
              <Textarea
                id="quick-action-command"
                rows={4}
                value={command}
                onChange={(event) => setCommand(event.currentTarget.value)}
                disabled={loading || compiling}
                placeholder={t('sidebar.captureAutomation.commandPlaceholder')}
                autoFocus={inputMode === 'command'}
                className="font-mono text-xs"
              />
              <FieldDescription>
                {t(
                  inputMode === 'describe'
                    ? 'sidebar.captureAutomation.generatedCommandDescription'
                    : 'sidebar.captureAutomation.directCommandDescription'
                )}
              </FieldDescription>
              {commandNeedsRefresh ? (
                <FieldDescription className="text-status-in-progress">
                  {t('sidebar.captureAutomation.commandNeedsRefresh')}
                </FieldDescription>
              ) : null}
              {inputMode === 'describe' && explanation ? (
                <FieldDescription>
                  {t('sidebar.captureAutomation.commandEvidence', { explanation })}
                </FieldDescription>
              ) : null}
            </Field>
          ) : null}

          {showCommandField && hasCommand ? (
            <Field className="border-t border-border pt-5">
              <FieldLabel htmlFor="quick-action-label">
                {t('sidebar.captureAutomation.actionLabel')}
              </FieldLabel>
              <Input
                id="quick-action-label"
                value={label}
                disabled={loading}
                placeholder={t('sidebar.captureAutomation.actionLabelPlaceholder')}
                onChange={(event) => handleLabelChange(event.currentTarget.value)}
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
        <ConfirmButton onClick={() => void handlePrimaryAction()} disabled={primaryDisabled}>
          {compiling ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              {t('sidebar.captureAutomation.generatingCommand')}
            </>
          ) : submitting ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              {t('sidebar.captureAutomation.savingAndRunning')}
            </>
          ) : inputMode === 'describe' && !hasCurrentGeneratedCommand ? (
            <>
              <WandSparkles className="size-3.5" />
              {t(
                compiledIntent === null
                  ? 'sidebar.captureAutomation.generateCommand'
                  : 'sidebar.captureAutomation.regenerateCommand'
              )}
            </>
          ) : (
            t('sidebar.captureAutomation.saveAndRun')
          )}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
