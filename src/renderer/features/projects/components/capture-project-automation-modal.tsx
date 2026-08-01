import { Bot, Loader2, Package, TerminalSquare, WandSparkles } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Branch } from '@shared/git';
import type { QuickAction } from '@shared/project-settings';
import type { CompiledQuickAction, ProjectPackageScript } from '@shared/quick-actions';
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
import { cn } from '@renderer/utils/utils';

type CaptureProjectAutomationModalArgs = {
  projectId: string;
  projectName: string;
};

type Props = BaseModalProps<void> & CaptureProjectAutomationModalArgs;
type InputMode = 'package' | 'command' | 'describe';

function genId(): string {
  return crypto.randomUUID();
}

function compiledContent(result: CompiledQuickAction): string {
  return result.kind === 'command' ? result.command : result.instruction;
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
  const [scriptsLoading, setScriptsLoading] = useState(true);
  const [scriptsFailed, setScriptsFailed] = useState(false);
  const [scripts, setScripts] = useState<ProjectPackageScript[]>([]);
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<InputMode>('package');
  const [intent, setIntent] = useState('');
  const [intentTokens, setIntentTokens] = useState<PromptToken[]>([]);
  const [manualCommand, setManualCommand] = useState('');
  const [compiled, setCompiled] = useState<CompiledQuickAction | null>(null);
  const [compiledIntent, setCompiledIntent] = useState<string | null>(null);
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
      setScriptsLoading(false);
      return;
    }
    setError(null);
    setLoading(true);
    setScriptsLoading(true);
    setScriptsFailed(false);
    void settingsStore.pageData
      .load()
      .catch(() => {
        if (!cancelled) setError(t('projects.settings.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    void rpc.quickActions
      .discover(projectId)
      .then((items) => {
        if (cancelled) return;
        setScripts(items);
        setSelectedScriptId((current) => current ?? items[0]?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setScriptsFailed(true);
      })
      .finally(() => {
        if (!cancelled) setScriptsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, settingsStore, t]);

  const selectedScript = scripts.find((script) => script.id === selectedScriptId) ?? null;
  const cleanedIntent = intent.trim();
  const serializedIntent = useMemo(
    () => serializePromptWithTokens(intent, intentTokens, { imagesAsPaths: true }).text.trim(),
    [intent, intentTokens]
  );
  const cleanedManualCommand = manualCommand.trim();
  const hasCurrentAnalysis =
    compiled !== null && compiledIntent === serializedIntent && serializedIntent.length > 0;
  const isLocalProject = projectData?.type === 'local';
  const runtimeCanCompile = runtimeId === 'codex' || runtimeId === 'claude';
  const compilationUnavailable = !isLocalProject || !runtimeCanCompile || createDisabled;
  const actionContent =
    inputMode === 'package'
      ? (selectedScript?.command ?? '')
      : inputMode === 'command'
        ? cleanedManualCommand
        : compiled
          ? compiledContent(compiled).trim()
          : cleanedIntent;
  const suggestedLabel = useMemo(
    () =>
      inputMode === 'package' && selectedScript
        ? selectedScript.label
        : inputMode === 'describe' && hasCurrentAnalysis && compiled
          ? compiled.label
          : taskNameFromPrompt(actionContent),
    [actionContent, compiled, hasCurrentAnalysis, inputMode, selectedScript]
  );
  const analysisNeedsRefresh =
    inputMode === 'describe' && compiled !== null && compiledIntent !== serializedIntent;
  const hasAction =
    inputMode === 'package'
      ? selectedScript !== null
      : inputMode === 'command'
        ? cleanedManualCommand.length > 0
        : hasCurrentAnalysis && actionContent.length > 0;

  useEffect(() => {
    if (labelOverridden) return;
    setLabel(suggestedLabel);
  }, [labelOverridden, suggestedLabel]);

  const handleLabelChange = (next: string) => {
    setLabel(next);
    setLabelOverridden(next.trim().length > 0);
  };

  const handleCompile = async () => {
    if (!serializedIntent) {
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
        intent: serializedIntent,
        runtimeId,
      });
      setCompiled(result);
      setCompiledIntent(serializedIntent);
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

  const buildAction = (): QuickAction | null => {
    const cleanedLabel =
      label.trim() || suggestedLabel || t('sidebar.captureAutomation.defaultLabel');
    if (inputMode === 'package' && selectedScript) {
      return {
        id: quickActionId,
        label: cleanedLabel,
        command: selectedScript.command,
        kind: 'command',
      };
    }
    if (inputMode === 'command' && cleanedManualCommand) {
      return {
        id: quickActionId,
        label: cleanedLabel,
        command: cleanedManualCommand,
        kind: 'command',
      };
    }
    if (inputMode === 'describe' && hasCurrentAnalysis && compiled) {
      return {
        id: quickActionId,
        label: cleanedLabel,
        command: compiledContent(compiled).trim(),
        kind: compiled.kind,
        sourceIntent: serializedIntent,
      };
    }
    return null;
  };

  const saveQuickAction = async (action: QuickAction): Promise<boolean> => {
    const currentSettings = settingsStore?.settings;
    if (!settingsStore || !currentSettings) {
      setError(t('projects.projectNotReady'));
      return false;
    }
    const currentActions = currentSettings.quickActions ?? [];
    const existing = currentActions.find(
      (item) => item.kind === action.kind && item.command.trim() === action.command.trim()
    );
    const savedAction = existing ? { ...action, id: existing.id } : action;
    const nextActions = existing
      ? currentActions.map((item) => (item.id === existing.id ? savedAction : item))
      : [...currentActions, savedAction];
    const nextSettings = JSON.parse(
      JSON.stringify({
        ...currentSettings,
        quickActions: nextActions,
      })
    ) as typeof currentSettings;
    const updateRes = await settingsStore.save(nextSettings);
    return updateRes.success;
  };

  const handleSubmit = async () => {
    if (loading || submitting) return;
    const action = buildAction();
    if (!action) {
      setError(
        inputMode === 'describe'
          ? t('sidebar.captureAutomation.analyzeBeforeRun')
          : t('sidebar.captureAutomation.commandRequired')
      );
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const project = asMounted(getProjectStore(projectId));
      if (!project) {
        setError(t('sidebar.captureAutomation.executionUnavailable'));
        return;
      }

      let defaultBranch: Branch | undefined;
      if (action.kind === 'skill') {
        const repository = getRepositoryStore(projectId);
        if (!repository || !runtimeId) {
          setError(t('sidebar.captureAutomation.skillExecutionUnavailable'));
          return;
        }
        await Promise.all([repository.localData.load(), repository.remoteData.load()]);
        defaultBranch = repository.defaultBranch;
        if (!defaultBranch) {
          setError(t('sidebar.captureAutomation.skillExecutionUnavailable'));
          return;
        }
      }

      const result = await runProjectQuickAction({
        project,
        action,
        runtimeId,
        defaultBranch,
      });
      const saved = await saveQuickAction(action);
      if (!saved) {
        setError(t('sidebar.captureAutomation.executedButSaveFailed'));
        return;
      }
      onSuccess();
      if (result.kind === 'skill') {
        navigate('task', { projectId, taskId: result.taskId });
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
    if (inputMode === 'describe' && !hasCurrentAnalysis) {
      await handleCompile();
      return;
    }
    await handleSubmit();
  };

  const primaryDisabled =
    loading ||
    compiling ||
    submitting ||
    (inputMode === 'package'
      ? scriptsLoading || !selectedScript
      : inputMode === 'command'
        ? !cleanedManualCommand
        : hasCurrentAnalysis
          ? !actionContent
          : !serializedIntent || compilationUnavailable);

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
              <ToggleGroupItem value="package" className="flex-1">
                <Package className="size-3.5" />
                {t('sidebar.captureAutomation.packageMode')}
              </ToggleGroupItem>
              <ToggleGroupItem value="command" className="flex-1">
                <TerminalSquare className="size-3.5" />
                {t('sidebar.captureAutomation.commandMode')}
              </ToggleGroupItem>
              <ToggleGroupItem value="describe" className="flex-1">
                <WandSparkles className="size-3.5" />
                {t('sidebar.captureAutomation.describeMode')}
              </ToggleGroupItem>
            </ToggleGroup>
          </Field>

          {inputMode === 'package' ? (
            <Field>
              <FieldLabel>{t('sidebar.captureAutomation.packageScriptLabel')}</FieldLabel>
              <FieldDescription>
                {t('sidebar.captureAutomation.packageScriptDescription')}
              </FieldDescription>
              <div className="max-h-56 overflow-y-auto rounded-md border border-border p-1">
                {scriptsLoading ? (
                  <div className="flex items-center gap-2 px-3 py-4 text-xs text-foreground-muted">
                    <Loader2 className="size-3.5 animate-spin" />
                    {t('sidebar.captureAutomation.loadingScripts')}
                  </div>
                ) : scriptsFailed ? (
                  <p className="px-3 py-4 text-xs text-destructive">
                    {t('sidebar.captureAutomation.loadScriptsFailed')}
                  </p>
                ) : scripts.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-foreground-muted">
                    {t('sidebar.captureAutomation.noPackageScripts')}
                  </p>
                ) : (
                  scripts.map((script) => {
                    const selected = script.id === selectedScriptId;
                    return (
                      <button
                        key={script.id}
                        type="button"
                        data-package-script-id={script.id}
                        aria-pressed={selected}
                        className={cn(
                          'flex w-full flex-col gap-0.5 rounded-sm px-3 py-2 text-left outline-none transition-colors',
                          'hover:bg-background-quaternary focus-visible:ring-2 focus-visible:ring-ring',
                          selected && 'bg-background-quaternary'
                        )}
                        onClick={() => setSelectedScriptId(script.id)}
                      >
                        <span className="text-sm font-medium">{script.label}</span>
                        <span className="font-mono text-[11px] text-foreground-muted">
                          {script.command}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </Field>
          ) : null}

          {inputMode === 'command' ? (
            <Field>
              <FieldLabel htmlFor="quick-action-command">
                {t('sidebar.captureAutomation.directCommandLabel')}
              </FieldLabel>
              <Textarea
                id="quick-action-command"
                rows={4}
                value={manualCommand}
                onChange={(event) => setManualCommand(event.currentTarget.value)}
                disabled={loading}
                placeholder={t('sidebar.captureAutomation.commandPlaceholder')}
                autoFocus
                className="font-mono text-xs"
              />
              <FieldDescription>
                {t('sidebar.captureAutomation.directCommandDescription')}
              </FieldDescription>
            </Field>
          ) : null}

          {inputMode === 'describe' ? (
            <Field>
              <FieldLabel htmlFor="quick-action-intent">
                {t('sidebar.captureAutomation.intentLabel')}
              </FieldLabel>
              <ComposerPromptInput
                textareaId="quick-action-intent"
                value={intent}
                onChange={setIntent}
                tokens={intentTokens}
                onTokensChange={setIntentTokens}
                runtimeId={runtimeId}
                projectId={projectId}
                projectPath={projectData?.path}
                imagesAsPaths
                runHostKind={projectData?.type === 'ssh' ? 'ssh' : 'local'}
                disabled={loading || compiling}
                placeholder={t('sidebar.captureAutomation.intentPlaceholder')}
                autoFocus
                canSubmit={Boolean(serializedIntent) && !compilationUnavailable}
                showSubmitButton={false}
                onSubmit={() => void handleCompile()}
                textareaClassName="min-h-24 text-sm"
              />
              <FieldDescription>
                {t('sidebar.captureAutomation.intentDescription')}
              </FieldDescription>
              {serializedIntent && compilationUnavailable && !hasCurrentAnalysis ? (
                <FieldDescription className="text-destructive">
                  {t('sidebar.captureAutomation.compilationUnavailable')}
                </FieldDescription>
              ) : null}
            </Field>
          ) : null}

          {inputMode === 'describe' && compiled ? (
            <Field>
              <div className="flex items-center justify-between gap-3">
                <FieldLabel htmlFor="quick-action-generated-content">
                  {t(
                    compiled.kind === 'command'
                      ? 'sidebar.captureAutomation.generatedCommandLabel'
                      : 'sidebar.captureAutomation.generatedSkillLabel'
                  )}
                </FieldLabel>
                <span className="flex items-center gap-1 rounded-full bg-background-quaternary px-2 py-0.5 text-[11px] text-foreground-muted">
                  {compiled.kind === 'command' ? (
                    <TerminalSquare className="size-3" />
                  ) : (
                    <Bot className="size-3" />
                  )}
                  {t(
                    compiled.kind === 'command'
                      ? 'sidebar.captureAutomation.commandKind'
                      : 'sidebar.captureAutomation.skillKind'
                  )}
                </span>
              </div>
              <Textarea
                id="quick-action-generated-content"
                rows={4}
                value={compiledContent(compiled)}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setCompiled((current) =>
                    current?.kind === 'command'
                      ? { ...current, command: value }
                      : current?.kind === 'skill'
                        ? { ...current, instruction: value }
                        : current
                  );
                }}
                disabled={loading || compiling}
                className={compiled.kind === 'command' ? 'font-mono text-xs' : undefined}
              />
              <FieldDescription>
                {t(
                  compiled.kind === 'command'
                    ? 'sidebar.captureAutomation.generatedCommandDescription'
                    : 'sidebar.captureAutomation.generatedSkillDescription'
                )}
              </FieldDescription>
              {analysisNeedsRefresh ? (
                <FieldDescription className="text-status-in-progress">
                  {t('sidebar.captureAutomation.analysisNeedsRefresh')}
                </FieldDescription>
              ) : null}
              <FieldDescription>
                {t('sidebar.captureAutomation.analysisEvidence', {
                  explanation: compiled.explanation,
                })}
              </FieldDescription>
            </Field>
          ) : null}

          {hasAction ? (
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
              {t('sidebar.captureAutomation.analyzing')}
            </>
          ) : submitting ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              {t('sidebar.captureAutomation.runningAndSaving')}
            </>
          ) : inputMode === 'describe' && !hasCurrentAnalysis ? (
            <>
              <WandSparkles className="size-3.5" />
              {t(
                compiledIntent === null
                  ? 'sidebar.captureAutomation.analyze'
                  : 'sidebar.captureAutomation.analyzeAgain'
              )}
            </>
          ) : (
            t('sidebar.captureAutomation.runAndSave')
          )}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
