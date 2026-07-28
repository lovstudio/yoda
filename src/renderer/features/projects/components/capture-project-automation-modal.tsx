import { Bot, Check, FileCode2, ListPlus, Loader2, WandSparkles } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { QuickAction } from '@shared/project-settings';
import { taskNameFromPrompt } from '@shared/task-name';
import { ComposerPromptInput } from '@renderer/app/composer-prompt-input';
import {
  serializePromptWithTokens,
  type PromptToken,
} from '@renderer/app/prompt-attachment-tokens';
import { runProjectQuickAction } from '@renderer/features/projects/run-project-quick-action';
import {
  asMounted,
  getProjectSettingsStore,
  getProjectStore,
} from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useEffectiveRuntime } from '@renderer/features/tasks/conversations/use-effective-runtime';
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
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';

type CaptureProjectAutomationModalArgs = {
  projectId: string;
  projectName: string;
};

type Props = BaseModalProps<void> & CaptureProjectAutomationModalArgs;
type Target = 'quickAction' | 'runScript' | 'skillDraft';

const fallbackSkillWorkflow =
  'Execute this project operation end to end. Infer the exact commands from the current repository, run the required checks, and report the local URL or verification evidence.';

function genId(): string {
  return crypto.randomUUID();
}

function buildSkillDraft(intent: string, quickActionLabel: string, quickActionCommand: string) {
  return [
    '---',
    `name: ${quickActionLabel || 'Project automation'}`,
    'description: Repeatable project operation captured from a natural-language request.',
    '---',
    '',
    '# When to use',
    '',
    intent.trim() || 'Use this skill for this project-specific repeatable operation.',
    '',
    '# Workflow',
    '',
    quickActionCommand.trim() || fallbackSkillWorkflow,
    '',
    '# Verification',
    '',
    'Before reporting success, provide concrete command output, URL, test result, or other evidence.',
  ].join('\n');
}

export const CaptureProjectAutomationModal = observer(function CaptureProjectAutomationModal({
  projectId,
  projectName,
  onSuccess,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [compiling, setCompiling] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState('');
  const [intentTokens, setIntentTokens] = useState<PromptToken[]>([]);
  const [target, setTarget] = useState<Target>('quickAction');
  const [label, setLabel] = useState('');
  const [labelOverridden, setLabelOverridden] = useState(false);
  const [command, setCommand] = useState('');
  const [compiledIntent, setCompiledIntent] = useState<string | null>(null);
  const [explanation, setExplanation] = useState('');
  const [setupScript, setSetupScript] = useState('');
  const [runScript, setRunScript] = useState('');
  const [teardownScript, setTeardownScript] = useState('');
  const [quickActionId] = useState(() => genId());
  const settingsStore = getProjectSettingsStore(projectId);
  const projectStore = getProjectStore(projectId);
  const mountedProject = asMounted(projectStore);
  const projectData = mountedProject?.data;
  const connectionId = projectData?.type === 'ssh' ? projectData.connectionId : undefined;
  const projectPath = projectData?.type === 'local' ? projectData.path : undefined;
  const runHostKind = projectData?.type === 'ssh' ? 'ssh' : 'local';
  const { value: homeDraft } = useAppSettingsKey('homeDraft');
  const runtimeOverrideValue =
    settingsStore?.settings?.composerDefaults?.runtimeId ?? homeDraft?.runtimeOverride ?? null;
  const ignoreRuntimeOverride = useCallback(() => {}, []);
  const { runtimeId, createDisabled } = useEffectiveRuntime(connectionId, {
    value: runtimeOverrideValue,
    set: ignoreRuntimeOverride,
  });
  const serializedIntent = useMemo(
    () => serializePromptWithTokens(intent, intentTokens, { imagesAsPaths: true }).text,
    [intent, intentTokens]
  );

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
      const scripts = settingsStore.settings?.scripts ?? {};
      setSetupScript(scripts.setup ?? '');
      setRunScript(scripts.run ?? '');
      setTeardownScript(scripts.teardown ?? '');
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [settingsStore, t]);

  const suggestedLabel = useMemo(() => taskNameFromPrompt(serializedIntent), [serializedIntent]);
  const skillDraft = useMemo(
    () => buildSkillDraft(serializedIntent, label || suggestedLabel, command),
    [command, serializedIntent, label, suggestedLabel]
  );
  const cleanedIntent = serializedIntent.trim();
  const hasIntent = cleanedIntent.length > 0;
  const hasCurrentCommand = compiledIntent === cleanedIntent && command.trim().length > 0;
  const hasPreviousCompilation = compiledIntent !== null;
  const intentChangedSinceCompilation = hasPreviousCompilation && compiledIntent !== cleanedIntent;
  const quickActionStep = !hasIntent ? 1 : hasCurrentCommand ? 3 : 2;
  const compilationUnavailable = !runtimeId || createDisabled;

  useEffect(() => {
    if (labelOverridden) return;
    setLabel(suggestedLabel);
  }, [labelOverridden, suggestedLabel]);

  const handleLabelChange = (next: string) => {
    setLabel(next);
    setLabelOverridden(next.trim().length > 0);
  };

  const handleCompile = async () => {
    const cleanedIntent = serializedIntent.trim();
    if (!cleanedIntent) {
      setError(t('sidebar.captureAutomation.intentRequired'));
      return;
    }
    if (!runtimeId || createDisabled) {
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
    const settingsStore = getProjectSettingsStore(projectId);
    const currentSettings = settingsStore?.settings;
    if (!settingsStore || !currentSettings) {
      setError(t('projects.projectNotReady'));
      return null;
    }
    const cleanedLabel =
      label.trim() || suggestedLabel || t('sidebar.captureAutomation.defaultLabel');
    const cleanedCommand = command.trim();
    if (!cleanedCommand) {
      setError(t('sidebar.captureAutomation.commandRequired'));
      return null;
    }
    const action: QuickAction = {
      id: quickActionId,
      label: cleanedLabel,
      command: cleanedCommand,
      kind: 'shell',
      sourceIntent: serializedIntent.trim(),
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

  const saveRunScripts = async () => {
    const settingsStore = getProjectSettingsStore(projectId);
    const currentSettings = settingsStore?.settings;
    if (!settingsStore || !currentSettings) {
      setError(t('projects.projectNotReady'));
      return false;
    }
    const nextSettings = JSON.parse(
      JSON.stringify({
        ...currentSettings,
        scripts: {
          setup: setupScript.trim() ? setupScript : undefined,
          run: runScript.trim() ? runScript : undefined,
          teardown: teardownScript.trim() ? teardownScript : undefined,
        },
      })
    ) as typeof currentSettings;
    const updateRes = await settingsStore.save(nextSettings);
    if (!updateRes.success) {
      setError(t('projects.settings.saveFailed'));
      return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    if (loading || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      if (target === 'runScript') {
        if (await saveRunScripts()) onSuccess();
        return;
      }

      const project = asMounted(getProjectStore(projectId));
      if (!project) {
        setError(t('sidebar.captureAutomation.executionUnavailable'));
        return;
      }
      if (compiledIntent !== serializedIntent.trim() || !command.trim()) {
        setError(t('sidebar.captureAutomation.generateBeforeSave'));
        return;
      }

      const action = await saveQuickAction();
      if (!action) return;

      try {
        await runProjectQuickAction({
          project,
          action,
        });
        onSuccess();
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
    if (target === 'quickAction' && !hasCurrentCommand) {
      await handleCompile();
      return;
    }
    await handleSubmit();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('sidebar.captureAutomation.title', { name: projectName })}</DialogTitle>
      </DialogHeader>
      <DialogContentArea>
        <FieldGroup>
          <Field>
            <FieldLabel>{t('sidebar.captureAutomation.intentLabel')}</FieldLabel>
            <ComposerPromptInput
              value={intent}
              onChange={setIntent}
              tokens={intentTokens}
              onTokensChange={setIntentTokens}
              runtimeId={runtimeId}
              projectId={projectId}
              projectPath={projectPath}
              runHostKind={runHostKind}
              disabled={loading}
              placeholder={t('sidebar.captureAutomation.intentPlaceholder')}
              showSubmitButton={false}
            />
            <FieldDescription>{t('sidebar.captureAutomation.intentDescription')}</FieldDescription>
          </Field>

          <div className="grid grid-cols-3 gap-2">
            <Button
              type="button"
              variant={target === 'quickAction' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTarget('quickAction')}
            >
              <ListPlus className="size-3.5" />
              {t('sidebar.captureAutomation.quickActionTarget')}
            </Button>
            <Button
              type="button"
              variant={target === 'runScript' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTarget('runScript')}
            >
              <FileCode2 className="size-3.5" />
              {t('sidebar.captureAutomation.runScriptTarget')}
            </Button>
            <Button
              type="button"
              variant={target === 'skillDraft' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTarget('skillDraft')}
            >
              <Bot className="size-3.5" />
              {t('sidebar.captureAutomation.skillTarget')}
            </Button>
          </div>

          {target === 'quickAction' && (
            <FieldGroup>
              <ol
                aria-label={t('sidebar.captureAutomation.workflowLabel')}
                className="grid grid-cols-3 gap-2"
              >
                {[
                  t('sidebar.captureAutomation.stepDescribe'),
                  t('sidebar.captureAutomation.stepReviewCommand'),
                  t('sidebar.captureAutomation.stepSaveAndRun'),
                ].map((stepLabel, index) => {
                  const step = index + 1;
                  const isCurrent = quickActionStep === step;
                  const isComplete = quickActionStep > step;
                  return (
                    <li
                      key={stepLabel}
                      aria-current={isCurrent ? 'step' : undefined}
                      className={cn(
                        'flex min-w-0 items-center gap-2 rounded-md border border-border px-2.5 py-2 text-xs text-foreground-muted',
                        isCurrent && 'border-primary/40 bg-primary/5 text-foreground',
                        isComplete && 'bg-background-1 text-foreground'
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background font-mono text-[10px] text-foreground-passive',
                          isCurrent && 'border-primary text-primary',
                          isComplete && 'border-status-done/50 bg-status-done/10 text-status-done'
                        )}
                      >
                        {isComplete ? <Check className="size-3" aria-hidden /> : step}
                      </span>
                      <span className="min-w-0 leading-tight">{stepLabel}</span>
                    </li>
                  );
                })}
              </ol>
              {hasIntent && compilationUnavailable && !hasCurrentCommand ? (
                <FieldDescription className="text-destructive">
                  {t('sidebar.captureAutomation.compilationUnavailable')}
                </FieldDescription>
              ) : null}
              <Field>
                <FieldLabel>{t('sidebar.captureAutomation.actionLabel')}</FieldLabel>
                <Input
                  value={label}
                  disabled={loading}
                  placeholder={t('sidebar.captureAutomation.actionLabelPlaceholder')}
                  onChange={(e) => handleLabelChange(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>{t('sidebar.captureAutomation.actionCommand')}</FieldLabel>
                <Textarea
                  rows={5}
                  value={command}
                  disabled={loading || compiling}
                  placeholder={t('sidebar.captureAutomation.actionCommandPlaceholder')}
                  onChange={(e) => setCommand(e.target.value)}
                />
                <FieldDescription>
                  {t('sidebar.captureAutomation.quickActionDescription')}
                </FieldDescription>
                {intentChangedSinceCompilation ? (
                  <FieldDescription className="text-status-in-progress">
                    {t('sidebar.captureAutomation.commandNeedsRefresh')}
                  </FieldDescription>
                ) : null}
                {explanation ? (
                  <FieldDescription>
                    {t('sidebar.captureAutomation.commandEvidence', { explanation })}
                  </FieldDescription>
                ) : null}
              </Field>
            </FieldGroup>
          )}

          {target === 'runScript' && (
            <FieldGroup>
              <Field>
                <FieldLabel>{t('sidebar.runScripts.beforeRun')}</FieldLabel>
                <Textarea
                  rows={3}
                  value={setupScript}
                  disabled={loading}
                  placeholder="npm install"
                  onChange={(e) => setSetupScript(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>{t('sidebar.runScripts.runScript')}</FieldLabel>
                <Textarea
                  rows={3}
                  value={runScript}
                  disabled={loading}
                  placeholder="npm run dev"
                  onChange={(e) => setRunScript(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>{t('sidebar.runScripts.teardown')}</FieldLabel>
                <Textarea
                  rows={3}
                  value={teardownScript}
                  disabled={loading}
                  placeholder="docker compose down"
                  onChange={(e) => setTeardownScript(e.target.value)}
                />
              </Field>
            </FieldGroup>
          )}

          {target === 'skillDraft' && (
            <Field>
              <FieldLabel>{t('sidebar.captureAutomation.skillDraft')}</FieldLabel>
              <Textarea rows={12} value={skillDraft} readOnly />
              <FieldDescription>
                {t('sidebar.captureAutomation.skillDraftDescription')}
              </FieldDescription>
            </Field>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </FieldGroup>
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        {target === 'skillDraft' ? (
          <Button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(skillDraft);
              onSuccess();
            }}
          >
            <WandSparkles className="size-3.5" />
            {t('sidebar.captureAutomation.copySkillDraft')}
          </Button>
        ) : (
          <ConfirmButton
            onClick={() => void handlePrimaryAction()}
            disabled={
              loading ||
              compiling ||
              submitting ||
              (target === 'quickAction' &&
                !hasCurrentCommand &&
                (!hasIntent || compilationUnavailable))
            }
          >
            {target === 'quickAction' ? (
              compiling ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  {t('sidebar.captureAutomation.generatingCommand')}
                </>
              ) : submitting ? (
                t('sidebar.captureAutomation.savingAndRunning')
              ) : hasCurrentCommand ? (
                t('sidebar.captureAutomation.saveAndRun')
              ) : (
                <>
                  <WandSparkles className="size-3.5" />
                  {t(
                    hasPreviousCompilation
                      ? 'sidebar.captureAutomation.regenerateCommand'
                      : 'sidebar.captureAutomation.generateCommand'
                  )}
                </>
              )
            ) : submitting ? (
              t('common.saving')
            ) : (
              t('sidebar.captureAutomation.save')
            )}
          </ConfirmButton>
        )}
      </DialogFooter>
    </>
  );
});
