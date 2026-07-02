import { Bot, FileCode2, ListPlus, WandSparkles } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { QuickAction } from '@shared/project-settings';
import { ComposerPromptInput } from '@renderer/app/composer-prompt-input';
import {
  serializePromptWithTokens,
  type PromptToken,
} from '@renderer/app/prompt-attachment-tokens';
import {
  asMounted,
  getProjectSettingsStore,
  getProjectStore,
} from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useEffectiveRuntime } from '@renderer/features/tasks/conversations/use-effective-runtime';
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
type Target = 'quickAction' | 'runScript' | 'skillDraft';

const fallbackQuickActionPrompt =
  'Execute this project operation end to end. Infer the exact commands from the current repository, run the required checks, and report the local URL or verification evidence.';

function genId(): string {
  return crypto.randomUUID();
}

function compactTitle(input: string): string {
  const firstLine = input
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return '';
  return firstLine.length > 18 ? `${firstLine.slice(0, 18).trim()}...` : firstLine;
}

function buildQuickActionCommand(intent: string): string {
  const trimmed = intent.trim();
  if (!trimmed) return fallbackQuickActionPrompt;
  return [
    trimmed,
    '',
    'Treat this as a repeatable project operation: identify repository conventions, run the required commands, and finish with concrete verification evidence.',
  ].join('\n');
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
    quickActionCommand.trim() || fallbackQuickActionPrompt,
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState('');
  const [intentTokens, setIntentTokens] = useState<PromptToken[]>([]);
  const [target, setTarget] = useState<Target>('quickAction');
  const [label, setLabel] = useState('');
  const [command, setCommand] = useState(fallbackQuickActionPrompt);
  const [setupScript, setSetupScript] = useState('');
  const [runScript, setRunScript] = useState('');
  const [teardownScript, setTeardownScript] = useState('');
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
  const { runtimeId } = useEffectiveRuntime(connectionId, {
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

  const suggestedLabel = useMemo(() => compactTitle(serializedIntent), [serializedIntent]);
  const skillDraft = useMemo(
    () => buildSkillDraft(serializedIntent, label || suggestedLabel, command),
    [command, serializedIntent, label, suggestedLabel]
  );

  useEffect(() => {
    const nextLabel = compactTitle(serializedIntent);
    setLabel((current) => (current.trim() ? current : nextLabel));
    setCommand(buildQuickActionCommand(serializedIntent));
  }, [serializedIntent]);

  const saveQuickAction = async () => {
    const settingsStore = getProjectSettingsStore(projectId);
    const currentSettings = settingsStore?.settings;
    if (!settingsStore || !currentSettings) {
      setError(t('projects.projectNotReady'));
      return false;
    }
    const cleanedLabel =
      label.trim() || suggestedLabel || t('sidebar.captureAutomation.defaultLabel');
    const cleanedCommand = command.trim();
    if (!cleanedCommand) {
      setError(t('sidebar.captureAutomation.commandRequired'));
      return false;
    }
    const action: QuickAction = {
      id: genId(),
      label: cleanedLabel,
      command: cleanedCommand,
    };
    const nextSettings = JSON.parse(
      JSON.stringify({
        ...currentSettings,
        quickActions: [...(currentSettings.quickActions ?? []), action],
      })
    ) as typeof currentSettings;
    const updateRes = await settingsStore.save(nextSettings);
    if (!updateRes.success) {
      setError(t('projects.settings.saveFailed'));
      return false;
    }
    return true;
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
    const ok = target === 'runScript' ? await saveRunScripts() : await saveQuickAction();
    setSubmitting(false);
    if (ok) onSuccess();
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
              <Field>
                <FieldLabel>{t('sidebar.captureAutomation.actionLabel')}</FieldLabel>
                <Input
                  value={label}
                  disabled={loading}
                  placeholder={t('sidebar.captureAutomation.actionLabelPlaceholder')}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>{t('sidebar.captureAutomation.actionCommand')}</FieldLabel>
                <Textarea
                  rows={5}
                  value={command}
                  disabled={loading}
                  onChange={(e) => setCommand(e.target.value)}
                />
                <FieldDescription>
                  {t('sidebar.captureAutomation.quickActionDescription')}
                </FieldDescription>
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
          <ConfirmButton onClick={() => void handleSubmit()} disabled={loading || submitting}>
            {submitting ? t('common.saving') : t('sidebar.captureAutomation.save')}
          </ConfirmButton>
        )}
      </DialogFooter>
    </>
  );
});
