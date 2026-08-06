import { Loader2, Package, TerminalSquare, WandSparkles } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Branch } from '@shared/git';
import type { QuickAction } from '@shared/project-settings';
import type { ProjectPackageScript } from '@shared/quick-actions';
import { taskNameFromPrompt } from '@shared/task-name';
import { ComposerPromptInput } from '@renderer/app/composer-prompt-input';
import {
  serializePromptWithTokens,
  type PromptToken,
} from '@renderer/app/prompt-attachment-tokens';
import { promptInvokesSkill } from '@renderer/features/projects/quick-action-source';
import { runProjectQuickAction } from '@renderer/features/projects/run-project-quick-action';
import { saveProjectQuickAction } from '@renderer/features/projects/save-project-quick-action';
import {
  asMounted,
  getProjectSettingsStore,
  getProjectStore,
  getRepositoryStore,
} from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useEffectiveRuntime } from '@renderer/features/tasks/conversations/use-effective-runtime';
import { toast } from '@renderer/lib/hooks/use-toast';
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
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@renderer/lib/ui/tabs';
import { Textarea } from '@renderer/lib/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { cn } from '@renderer/utils/utils';

type CaptureProjectAutomationModalArgs = {
  projectId: string;
  projectName: string;
};

type Props = BaseModalProps<void> & CaptureProjectAutomationModalArgs;
type InputMode = 'natural' | 'command';
type CommandSource = 'package' | 'manual';

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
  const [scriptsLoading, setScriptsLoading] = useState(true);
  const [scriptsFailed, setScriptsFailed] = useState(false);
  const [scripts, setScripts] = useState<ProjectPackageScript[]>([]);
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
  const [branchLoading, setBranchLoading] = useState(true);
  const [defaultBranch, setDefaultBranch] = useState<Branch | undefined>();
  const [inputMode, setInputMode] = useState<InputMode>('natural');
  const [commandSource, setCommandSource] = useState<CommandSource>('package');
  const [intent, setIntent] = useState('');
  const [intentTokens, setIntentTokens] = useState<PromptToken[]>([]);
  const [manualCommand, setManualCommand] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedProject = asMounted(getProjectStore(projectId));
  const projectData = mountedProject?.data;
  const repository = getRepositoryStore(projectId);
  const settingsStore = getProjectSettingsStore(projectId);
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
    setScriptsLoading(true);
    setScriptsFailed(false);
    void rpc.quickActions
      .discover(projectId)
      .then((items) => {
        if (cancelled) return;
        setScripts(items);
        setSelectedScriptId((current) => current ?? items[0]?.id ?? null);
        if (items.length === 0) setCommandSource('manual');
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
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    setBranchLoading(true);
    setDefaultBranch(undefined);
    if (!repository) {
      setBranchLoading(false);
      return;
    }
    void Promise.all([repository.localData.load(), repository.remoteData.load()])
      .then(() => {
        if (!cancelled) setDefaultBranch(repository.defaultBranch);
      })
      .catch(() => {
        if (!cancelled) setDefaultBranch(undefined);
      })
      .finally(() => {
        if (!cancelled) setBranchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repository]);

  const selectedScript = scripts.find((script) => script.id === selectedScriptId) ?? null;
  const serializedIntent = useMemo(
    () => serializePromptWithTokens(intent, intentTokens, { imagesAsPaths: true }).text.trim(),
    [intent, intentTokens]
  );
  const cleanedManualCommand = manualCommand.trim();
  const selectedCommand =
    commandSource === 'package' ? (selectedScript?.command ?? '') : cleanedManualCommand;
  const selectedCommandLabel =
    commandSource === 'package' && selectedScript
      ? selectedScript.label
      : taskNameFromPrompt(selectedCommand);

  const showAsyncFailure = useCallback(
    (submitError: unknown) => {
      toast.error(
        t('sidebar.captureAutomation.submitFailed', {
          error: submitError instanceof Error ? submitError.message : String(submitError),
        })
      );
    },
    [t]
  );

  const handleNaturalLanguage = () => {
    if (submitting) return;
    if (!serializedIntent) {
      setError(t('sidebar.captureAutomation.intentRequired'));
      return;
    }
    const project = asMounted(getProjectStore(projectId));
    if (!project || !runtimeId || !defaultBranch || createDisabled) {
      setError(t('sidebar.captureAutomation.skillExecutionUnavailable'));
      return;
    }

    setSubmitting(true);
    setError(null);
    let enteredTask = false;
    const action: QuickAction = {
      id: genId(),
      label: taskNameFromPrompt(serializedIntent),
      command: serializedIntent,
      kind: 'skill',
      sourceIntent: serializedIntent,
    };
    const execution = runProjectQuickAction({
      project,
      action,
      runtimeId,
      defaultBranch,
      quickActionSource: {
        prompt: serializedIntent,
        invokedSkill: promptInvokesSkill(serializedIntent),
      },
      onTaskCreated: (taskId) => {
        enteredTask = true;
        onSuccess();
        navigate('task', { projectId, taskId });
      },
    });
    void execution
      .catch((submitError) => {
        if (enteredTask) showAsyncFailure(submitError);
        else
          setError(
            t('sidebar.captureAutomation.submitFailed', {
              error: submitError instanceof Error ? submitError.message : String(submitError),
            })
          );
      })
      .finally(() => {
        if (!enteredTask) setSubmitting(false);
      });
  };

  const handleCommand = () => {
    if (submitting || !selectedCommand) return;
    const project = asMounted(getProjectStore(projectId));
    if (!project) {
      setError(t('sidebar.captureAutomation.executionUnavailable'));
      return;
    }

    setSubmitting(true);
    setError(null);
    const action: QuickAction = {
      id: genId(),
      label: selectedCommandLabel || t('sidebar.captureAutomation.defaultLabel'),
      command: selectedCommand,
      kind: 'command',
    };
    const execution = runProjectQuickAction({ project, action, runtimeId });
    onSuccess();
    void execution.then(
      async () => {
        try {
          if (!(await saveProjectQuickAction(projectId, action))) {
            toast.error(t('sidebar.captureAutomation.executedButSaveFailed'));
          }
        } catch {
          toast.error(t('sidebar.captureAutomation.executedButSaveFailed'));
        }
      },
      (submitError) => {
        showAsyncFailure(submitError);
      }
    );
  };

  const primaryDisabled =
    submitting ||
    (inputMode === 'natural'
      ? !serializedIntent || branchLoading || !defaultBranch || !runtimeId || createDisabled
      : !selectedCommand || (commandSource === 'package' && scriptsLoading));

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('sidebar.captureAutomation.title', { name: projectName })}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="gap-5">
        <Tabs
          value={inputMode}
          onValueChange={(value) => {
            setInputMode(value as InputMode);
            setError(null);
          }}
          className="gap-5"
        >
          <TabsList aria-label={t('sidebar.captureAutomation.inputModeLabel')}>
            <TabsIndicator />
            <TabsTab value="natural">
              <WandSparkles className="size-3.5" />
              {t('sidebar.captureAutomation.naturalMode')}
            </TabsTab>
            <TabsTab value="command">
              <TerminalSquare className="size-3.5" />
              {t('sidebar.captureAutomation.commandMode')}
            </TabsTab>
          </TabsList>

          <TabsPanel value="natural">
            <FieldGroup>
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
                  disabled={submitting}
                  placeholder={t('sidebar.captureAutomation.intentPlaceholder')}
                  autoFocus
                  canSubmit={!primaryDisabled}
                  showSubmitButton={false}
                  onSubmit={handleNaturalLanguage}
                  textareaClassName="min-h-28 text-sm"
                />
                <FieldDescription>
                  {t('sidebar.captureAutomation.naturalDescription')}
                </FieldDescription>
                {!branchLoading && (!defaultBranch || !runtimeId || createDisabled) ? (
                  <FieldDescription className="text-destructive">
                    {t('sidebar.captureAutomation.skillExecutionUnavailable')}
                  </FieldDescription>
                ) : null}
              </Field>
            </FieldGroup>
          </TabsPanel>

          <TabsPanel value="command">
            <FieldGroup className="gap-5">
              <Field>
                <FieldLabel>{t('sidebar.captureAutomation.commandSourceLabel')}</FieldLabel>
                <ToggleGroup
                  className="w-full"
                  aria-label={t('sidebar.captureAutomation.commandSourceLabel')}
                  value={[commandSource]}
                  onValueChange={([value]) => {
                    if (!value) return;
                    setCommandSource(value as CommandSource);
                    setError(null);
                  }}
                >
                  <ToggleGroupItem value="package" className="flex-1" disabled={scriptsFailed}>
                    <Package className="size-3.5" />
                    {t('sidebar.captureAutomation.packageMode')}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="manual" className="flex-1">
                    <TerminalSquare className="size-3.5" />
                    {t('sidebar.captureAutomation.manualMode')}
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>

              {commandSource === 'package' ? (
                <Field>
                  <FieldLabel>{t('sidebar.captureAutomation.packageScriptLabel')}</FieldLabel>
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
              ) : (
                <Field>
                  <FieldLabel htmlFor="quick-action-command">
                    {t('sidebar.captureAutomation.directCommandLabel')}
                  </FieldLabel>
                  <Textarea
                    id="quick-action-command"
                    rows={4}
                    value={manualCommand}
                    onChange={(event) => setManualCommand(event.currentTarget.value)}
                    disabled={submitting}
                    placeholder={t('sidebar.captureAutomation.commandPlaceholder')}
                    autoFocus
                    className="font-mono text-xs"
                  />
                </Field>
              )}
              <FieldDescription>
                {t('sidebar.captureAutomation.directCommandDescription')}
              </FieldDescription>
            </FieldGroup>
          </TabsPanel>
        </Tabs>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <ConfirmButton
          onClick={inputMode === 'natural' ? handleNaturalLanguage : handleCommand}
          disabled={primaryDisabled}
        >
          {inputMode === 'natural'
            ? branchLoading
              ? t('sidebar.captureAutomation.preparingTask')
              : t('sidebar.captureAutomation.startTask')
            : t('sidebar.captureAutomation.runCommand')}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
