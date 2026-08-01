import { Sparkles, TerminalSquare, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { QuickAction } from '@shared/project-settings';
import type { CompiledQuickAction, CompileQuickActionInput } from '@shared/quick-actions';
import { taskNameFromPrompt } from '@shared/task-name';
import { saveProjectQuickAction } from '@renderer/features/projects/save-project-quick-action';
import { getRegisteredTaskData } from '@renderer/features/tasks/stores/task-selectors';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';

const suggestionCache = new Map<string, Promise<CompiledQuickAction>>();

function requestSuggestion(
  key: string,
  input: CompileQuickActionInput
): Promise<CompiledQuickAction> {
  const cached = suggestionCache.get(key);
  if (cached) return cached;
  const request = rpc.quickActions.compile(input).catch((error) => {
    suggestionCache.delete(key);
    throw error;
  });
  suggestionCache.set(key, request);
  return request;
}

function dismissalKey(taskId: string): string {
  return `yoda.quick-action-suggestion.dismissed.${taskId}`;
}

function suggestedSkillName(label: string, taskId: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
  return slug || `project-operation-${taskId.slice(0, 6)}`;
}

export const QuickActionSuggestionControl = observer(function QuickActionSuggestionControl() {
  const { t } = useTranslation();
  const { projectId, taskId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const taskData = getRegisteredTaskData(projectId, taskId);
  const source = taskData?.quickActionSource;
  const conversation = source
    ? provisioned.conversations.conversations.get(source.conversationId)
    : undefined;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [suggestion, setSuggestion] = useState<CompiledQuickAction | null>(null);
  const [dismissed, setDismissed] = useState(
    () => globalThis.localStorage?.getItem(dismissalKey(taskId)) === '1'
  );
  const showCreateSkillModal = useShowModal('createSkillModal');

  const analysisKey = source
    ? `${taskId}:${source.conversationId}:${conversation?.data.lastInteractedAt ?? ''}`
    : null;
  const runtimeId = conversation?.data.runtimeId;
  const sessionCompleted = conversation?.status === 'completed';

  useEffect(() => {
    if (
      dismissed ||
      !source ||
      !analysisKey ||
      !sessionCompleted ||
      (runtimeId !== 'codex' && runtimeId !== 'claude')
    ) {
      if (!sessionCompleted) {
        setSuggestion(null);
        setOpen(false);
      }
      return;
    }

    let cancelled = false;
    void requestSuggestion(analysisKey, {
      projectId,
      intent: source.prompt,
      runtimeId,
      taskContext: { taskId, conversationId: source.conversationId },
    })
      .then((result) => {
        if (cancelled) return;
        if (result.kind === 'none') {
          setSuggestion(null);
          return;
        }
        setSuggestion(result);
        setOpen(true);
      })
      .catch(() => {
        if (!cancelled) setSuggestion(null);
      });
    return () => {
      cancelled = true;
    };
  }, [analysisKey, dismissed, projectId, runtimeId, sessionCompleted, source, taskId]);

  const reusableInstruction = useMemo(() => {
    if (!source || !suggestion) return '';
    return suggestion.kind === 'skill' ? suggestion.instruction : source.prompt;
  }, [source, suggestion]);

  if (dismissed || !source || !suggestion || suggestion.kind === 'none') return null;

  const dismiss = () => {
    globalThis.localStorage?.setItem(dismissalKey(taskId), '1');
    setDismissed(true);
    setOpen(false);
  };

  const save = async (kind: 'command' | 'skill') => {
    if (saving) return;
    const command =
      kind === 'command' && suggestion.kind === 'command'
        ? suggestion.command
        : reusableInstruction;
    if (!command.trim()) return;

    setSaving(true);
    const action: QuickAction = {
      id: crypto.randomUUID(),
      label:
        'label' in suggestion && suggestion.label.trim()
          ? suggestion.label
          : taskNameFromPrompt(command),
      command,
      kind,
      sourceIntent: source.prompt,
    };
    try {
      if (!(await saveProjectQuickAction(projectId, action))) {
        toast.error(t('tasks.quickActionSuggestion.saveFailed'));
        return;
      }
      toast.success(
        t(
          kind === 'command'
            ? 'tasks.quickActionSuggestion.commandSaved'
            : 'tasks.quickActionSuggestion.instructionSaved'
        )
      );
      dismiss();
    } catch {
      toast.error(t('tasks.quickActionSuggestion.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const createSkill = () => {
    showCreateSkillModal({
      initialName: suggestedSkillName(suggestion.label, taskId),
      initialDescription: source.prompt.slice(0, 160),
      initialContent: reusableInstruction,
      onSuccess: dismiss,
    });
  };

  const SuggestionIcon = suggestion.kind === 'command' ? TerminalSquare : Sparkles;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex h-7 items-center gap-1.5 rounded-md border border-primary/25 bg-primary/5 px-2 text-xs text-foreground transition-colors hover:bg-primary/10"
          >
            <SuggestionIcon className="size-3.5 text-primary" />
            {t(
              suggestion.kind === 'command'
                ? 'tasks.quickActionSuggestion.commandCta'
                : 'tasks.quickActionSuggestion.instructionCta'
            )}
          </button>
        }
      />
      <PopoverContent align="end" side="bottom" sideOffset={6} className="w-96 gap-3 p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">{t('tasks.quickActionSuggestion.title')}</p>
            <p className="text-xs leading-5 text-foreground-muted">
              {suggestion.explanation || t('tasks.quickActionSuggestion.description')}
            </p>
          </div>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={dismiss}
            aria-label={t('tasks.quickActionSuggestion.dismiss')}
          >
            <X className="size-3.5" />
          </Button>
        </div>

        {suggestion.kind === 'command' ? (
          <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded-md bg-background-2 px-2.5 py-2 font-mono text-[11px] leading-5 text-foreground">
            {suggestion.command}
          </pre>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={dismiss} disabled={saving}>
            {t('tasks.quickActionSuggestion.notNow')}
          </Button>
          {!source.invokedSkill ? (
            <Button variant="outline" size="sm" onClick={createSkill} disabled={saving}>
              {t('tasks.quickActionSuggestion.createSkill')}
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => void save('skill')} disabled={saving}>
            {t('tasks.quickActionSuggestion.saveInstruction')}
          </Button>
          {suggestion.kind === 'command' ? (
            <Button size="sm" onClick={() => void save('command')} disabled={saving}>
              {t('tasks.quickActionSuggestion.saveCommand')}
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
});
