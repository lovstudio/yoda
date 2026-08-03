import { Bot, Check, ListPlus, Search } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ensureUniqueTaskDisplayName, taskNameFromPrompt } from '@shared/task-name';
import {
  getProjectStore,
  getRepositoryStore,
  mountedProjectData,
} from '@renderer/features/projects/stores/project-selectors';
import { initialConversationTitle } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { useEffectiveRuntime } from '@renderer/features/tasks/conversations/use-effective-runtime';
import { registeredTaskData, type TaskStore } from '@renderer/features/tasks/stores/task';
import {
  getTaskManagerStore,
  isTaskDescendantOf,
} from '@renderer/features/tasks/stores/task-selectors';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
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
import { Field, FieldGroup, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { cn } from '@renderer/utils/utils';
import { ComposerPromptInput } from './composer-prompt-input';
import { serializePromptWithTokens, type PromptToken } from './prompt-attachment-tokens';

/**
 * Adds an existing child task or creates a new one. New tasks can remain a
 * session-less hierarchy node or start their initial Agent session immediately.
 * The main process validates the hierarchy again when an existing task is
 * re-parented.
 */
export const NewSubtaskModal = observer(function NewSubtaskModal({
  onSuccess,
  onClose,
  projectId,
  parentTaskId,
  initialAction = 'create-and-run',
}: BaseModalProps<void> & {
  projectId: string;
  parentTaskId: string;
  initialAction?: 'create-only' | 'create-and-run';
}) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const taskManager = getTaskManagerStore(projectId);
  const projectData = mountedProjectData(getProjectStore(projectId));
  const connectionId = projectData?.type === 'ssh' ? projectData.connectionId : undefined;
  const { runtimeId, setRuntimeOverride, createDisabled } = useEffectiveRuntime(connectionId);
  const [query, setQuery] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [promptTokens, setPromptTokens] = useState<PromptToken[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(() => {
    const result: TaskStore[] = [];
    for (const store of taskManager?.tasks.values() ?? []) {
      const data = registeredTaskData(store);
      if (!data || data.id === parentTaskId || data.archivedAt) continue;
      if (data.parentTaskId === parentTaskId) continue;
      if (isTaskDescendantOf(projectId, parentTaskId, data.id)) continue;
      result.push(store);
    }
    return result;
  }, [taskManager, projectId, parentTaskId]);

  const filteredCandidates = query.trim()
    ? candidates.filter((store) =>
        store.data.name.toLowerCase().includes(query.trim().toLowerCase())
      )
    : candidates;
  const newTaskName = taskNameFromPrompt(prompt);
  const canCreate = selectedTaskId !== null || newTaskName.length > 0;
  const canCreateAndRun =
    selectedTaskId === null && newTaskName.length > 0 && runtimeId !== null && !createDisabled;

  const clearPromptTokens = useCallback(() => {
    setPromptTokens((current) => {
      for (const token of current) {
        if (token.previewUrl) URL.revokeObjectURL(token.previewUrl);
      }
      return [];
    });
  }, []);

  const handleSubmit = useCallback(
    async (runAgent: boolean) => {
      if (!taskManager || !canCreate) return;
      if (runAgent && !canCreateAndRun) return;
      setIsSubmitting(true);
      setError(null);
      try {
        if (selectedTaskId) {
          const child = taskManager.tasks.get(selectedTaskId);
          if (!child) throw new Error(t('tasks.addSubtask.failed'));
          const result = await child.setParentTask(parentTaskId);
          if (result && !result.success) {
            throw new Error(t('tasks.addSubtask.failed'));
          }
        } else {
          const sourceBranch = getRepositoryStore(projectId)?.defaultBranch;
          if (!sourceBranch) throw new Error(t('tasks.addSubtask.failed'));
          const existingNames = Array.from(taskManager.tasks.values(), (store) => store.data.name);
          const taskId = crypto.randomUUID();
          const serializedPrompt = serializePromptWithTokens(prompt, promptTokens, {
            imagesAsPaths: false,
          });
          const initialPrompt = serializedPrompt.text.trim();
          const initialConversation =
            runAgent && runtimeId
              ? {
                  id: crypto.randomUUID(),
                  projectId,
                  taskId,
                  runtime: runtimeId,
                  title: initialConversationTitle(runtimeId, initialPrompt || undefined, []),
                  initialPrompt: initialPrompt || undefined,
                  imagePaths:
                    serializedPrompt.imagePaths.length > 0
                      ? serializedPrompt.imagePaths
                      : undefined,
                }
              : undefined;
          await taskManager.createTask({
            id: taskId,
            projectId,
            name: ensureUniqueTaskDisplayName(newTaskName, existingNames),
            sourceBranch,
            strategy: { kind: 'no-worktree' },
            parentTaskId,
            ...(initialConversation ? { initialConversation } : {}),
          });
          if (runAgent) navigate('task', { projectId, taskId });
        }
        onSuccess();
      } catch (submissionError) {
        setError(
          submissionError instanceof Error ? submissionError.message : t('tasks.addSubtask.failed')
        );
        setIsSubmitting(false);
      }
    },
    [
      taskManager,
      canCreate,
      canCreateAndRun,
      selectedTaskId,
      parentTaskId,
      projectId,
      newTaskName,
      prompt,
      promptTokens,
      runtimeId,
      navigate,
      onSuccess,
      t,
    ]
  );

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>{t('tasks.addSubtask.title')}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="gap-4 pt-0">
        <FieldGroup>
          <Field>
            <FieldLabel>{t('tasks.addSubtask.existingLabel')}</FieldLabel>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('tasks.addSubtask.searchPlaceholder')}
              />
            </div>
            <div className="max-h-52 overflow-y-auto rounded-md border border-border">
              {filteredCandidates.map((store) => (
                <button
                  key={store.data.id}
                  type="button"
                  onClick={() => {
                    setSelectedTaskId(store.data.id);
                    setPrompt('');
                    clearPromptTokens();
                    setError(null);
                  }}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-background-tertiary-1',
                    selectedTaskId === store.data.id && 'bg-background-tertiary-1'
                  )}
                >
                  <span className="min-w-0 truncate">{store.data.name}</span>
                  {selectedTaskId === store.data.id && <Check className="size-3.5 shrink-0" />}
                </button>
              ))}
              {filteredCandidates.length === 0 && (
                <div className="px-3 py-2 text-sm text-muted-foreground">
                  {t('tasks.addSubtask.noResults')}
                </div>
              )}
            </div>
          </Field>
          <Field>
            <FieldLabel>{t('tasks.addSubtask.newLabel')}</FieldLabel>
            <div className="flex flex-col gap-2">
              <AgentSelector
                value={runtimeId}
                onChange={setRuntimeOverride}
                connectionId={connectionId}
                disabled={isSubmitting}
              />
              <ComposerPromptInput
                value={prompt}
                onChange={(value) => {
                  setPrompt(value);
                  setSelectedTaskId(null);
                  setError(null);
                }}
                tokens={promptTokens}
                onTokensChange={(tokens) => {
                  setPromptTokens(tokens);
                  setSelectedTaskId(null);
                  setError(null);
                }}
                runtimeId={runtimeId}
                projectId={projectId}
                projectPath={projectData?.type === 'local' ? projectData.path : undefined}
                runHostKind={projectData?.type === 'ssh' ? 'ssh' : 'local'}
                placeholder={t('tasks.addSubtask.newPlaceholder')}
                disabled={isSubmitting}
                canSubmit={canCreateAndRun}
                showSubmitButton={false}
                onSubmit={() => void handleSubmit(initialAction === 'create-and-run')}
                autoFocus
                textareaClassName="min-h-24 text-sm"
              />
            </div>
            <p className="text-xs text-muted-foreground">{t('tasks.addSubtask.executionHint')}</p>
          </Field>
        </FieldGroup>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        {selectedTaskId ? (
          <ConfirmButton
            onClick={() => void handleSubmit(false)}
            disabled={!canCreate || isSubmitting}
          >
            <ListPlus className="size-4" />
            {t('tasks.addSubtask.addExisting')}
          </ConfirmButton>
        ) : (
          <>
            {initialAction === 'create-only' ? (
              <ConfirmButton
                onClick={() => void handleSubmit(false)}
                disabled={!canCreate || isSubmitting}
              >
                <ListPlus className="size-4" />
                {t('tasks.addSubtask.createOnly')}
              </ConfirmButton>
            ) : (
              <Button
                variant="outline"
                onClick={() => void handleSubmit(false)}
                disabled={!canCreate || isSubmitting}
              >
                <ListPlus className="size-4" />
                {t('tasks.addSubtask.createOnly')}
              </Button>
            )}
            {initialAction === 'create-and-run' ? (
              <ConfirmButton
                onClick={() => void handleSubmit(true)}
                disabled={!canCreateAndRun || isSubmitting}
              >
                <Bot className="size-4" />
                {t('tasks.addSubtask.createAndRun')}
              </ConfirmButton>
            ) : (
              <Button
                variant="outline"
                onClick={() => void handleSubmit(true)}
                disabled={!canCreateAndRun || isSubmitting}
              >
                <Bot className="size-4" />
                {t('tasks.addSubtask.createAndRun')}
              </Button>
            )}
          </>
        )}
      </DialogFooter>
    </>
  );
});
