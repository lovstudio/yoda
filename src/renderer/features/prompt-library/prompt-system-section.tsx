import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Loader2, Save, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { agentToDraft, type Agent } from '@shared/agents';
import type { RuntimeCustomConfigs } from '@shared/app-settings';
import { builtinAgentI18nKey } from '@shared/builtin-agents';
import type {
  EditableRuntimeInstructionFile,
  EditableRuntimeInstructionFilesRequest,
} from '@shared/conversations';
import type { DependencyStatusMap } from '@shared/dependencies';
import { RUNTIMES, type RuntimeDefinition, type RuntimeId } from '@shared/runtime-registry';
import { useAgents } from '@renderer/features/agents-config/use-agents';
import { AgentAvatar } from '@renderer/lib/components/agent-card/agent-avatar';
import { GlobalFileActionsDropdown } from '@renderer/lib/components/file-path-actions';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Tabs, TabsList, TabsTab } from '@renderer/lib/ui/tabs';
import { Textarea } from '@renderer/lib/ui/textarea';

const enabledPromptRuntimesQueryKey = ['promptLibrary', 'enabledRuntimes'] as const;

export async function loadEnabledPromptRuntimes(): Promise<RuntimeDefinition[]> {
  await rpc.dependencies.probeCategory('agent');
  const [dependencies, runtimeConfigs] = await Promise.all([
    rpc.dependencies.getAll() as Promise<DependencyStatusMap>,
    rpc.runtimeSettings.getAll() as Promise<RuntimeCustomConfigs>,
  ]);
  return RUNTIMES.filter(
    (runtime) =>
      dependencies[runtime.id]?.status === 'available' &&
      runtimeConfigs[runtime.id]?.disabled !== true
  );
}

function instructionFilesQueryKey(request: EditableRuntimeInstructionFilesRequest) {
  return [
    'promptLibrary',
    'instructionFiles',
    request.runtimeId,
    request.projectId ?? null,
  ] as const;
}

function useEditableInstructionFiles(request: EditableRuntimeInstructionFilesRequest) {
  return useQuery({
    queryKey: instructionFilesQueryKey(request),
    queryFn: () => rpc.conversations.getEditableRuntimeInstructionFiles(request),
  });
}

function displayAgentName(
  agent: Agent,
  t: (key: string) => string,
  exists: (key: string) => boolean
): string {
  const i18nKey = builtinAgentI18nKey(agent.slug);
  return i18nKey && exists(`${i18nKey}.name`) ? t(`${i18nKey}.name`) : agent.name;
}

function AgentSystemPromptEditor({
  agent,
  saving,
  onSave,
}: {
  agent: Agent;
  saving: boolean;
  onSave: (agent: Agent, systemPrompt: string) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [content, setContent] = useState(agent.systemPrompt);

  const name = displayAgentName(agent, t, i18n.exists.bind(i18n));
  const changed = content !== agent.systemPrompt;

  return (
    <div
      data-slot="agent-system-prompt"
      className="rounded-lg border border-border bg-background p-3"
    >
      <div className="flex min-w-0 items-center gap-2">
        <AgentAvatar name={name} icon={agent.icon} className="size-7 text-xs" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{name}</p>
          <p className="truncate text-[11px] text-foreground-passive">{agent.slug}</p>
        </div>
        <Badge variant="secondary">{t('promptLibrary.system.systemRole')}</Badge>
      </div>
      <Textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder={t('promptLibrary.system.agentPromptPlaceholder')}
        className="mt-3 min-h-32 resize-y font-mono text-xs leading-relaxed"
        aria-label={t('promptLibrary.system.agentPromptLabel', { name })}
      />
      <div className="mt-2 flex justify-end">
        <Button
          type="button"
          size="sm"
          disabled={!changed || saving}
          onClick={() => void onSave(agent, content)}
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}

export function PromptInstructionFileEditor({
  file,
  request,
}: {
  file: EditableRuntimeInstructionFile;
  request: EditableRuntimeInstructionFilesRequest;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [content, setContent] = useState(file.content);
  const save = useMutation({
    mutationFn: () =>
      rpc.conversations.saveEditableRuntimeInstructionFile({
        ...request,
        path: file.path,
        content,
      }),
    onSuccess: (saved) => {
      setContent(saved.content);
      queryClient.setQueryData<EditableRuntimeInstructionFile[]>(
        instructionFilesQueryKey(request),
        (current) => current?.map((entry) => (entry.path === saved.path ? saved : entry))
      );
      toast({ title: t('promptLibrary.system.fileSaved') });
    },
    onError: (error) =>
      toast({
        title: t('promptLibrary.system.fileSaveFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      }),
  });

  const changed = content !== file.content;
  const filename = file.path.split(/[\\/]/).pop() ?? file.path;

  return (
    <div
      data-slot="runtime-instruction-file"
      className="rounded-lg border border-border bg-background p-3"
    >
      <div className="flex min-w-0 items-center gap-2">
        <FileText className="size-4 shrink-0 text-foreground-muted" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{filename}</p>
          <p className="truncate font-mono text-[10px] text-foreground-passive" title={file.path}>
            {file.path}
          </p>
        </div>
        <Badge variant="secondary">
          {file.exists ? t('promptLibrary.system.existingFile') : t('promptLibrary.system.newFile')}
        </Badge>
        {file.exists ? <GlobalFileActionsDropdown absolutePath={file.path} /> : null}
      </div>
      <Textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder={t('promptLibrary.system.filePromptPlaceholder')}
        className="mt-3 min-h-32 resize-y font-mono text-xs leading-relaxed"
        aria-label={t('promptLibrary.system.filePromptLabel', { name: filename })}
      />
      <div className="mt-2 flex justify-end">
        <Button
          type="button"
          size="sm"
          disabled={!changed || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {file.exists ? t('common.save') : t('promptLibrary.system.createFile')}
        </Button>
      </div>
    </div>
  );
}

export function PromptInstructionFilesEditor({
  runtimeId,
  projectId,
  scope,
}: {
  runtimeId: RuntimeId;
  projectId?: string | null;
  scope: EditableRuntimeInstructionFile['scope'];
}) {
  const { t } = useTranslation();
  const request = useMemo(
    () => ({ runtimeId, projectId: projectId ?? null }),
    [projectId, runtimeId]
  );
  const { data: files = [], isLoading } = useEditableInstructionFiles(request);
  const scopedFiles = files.filter((file) => file.scope === scope);

  if (isLoading) {
    return (
      <div className="flex min-h-20 items-center justify-center">
        <Loader2 className="size-4 animate-spin text-foreground-muted" />
      </div>
    );
  }

  if (scopedFiles.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-foreground-muted">
        {t('promptLibrary.system.noInstructionFiles')}
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {scopedFiles.map((file) => (
        <PromptInstructionFileEditor
          key={`${file.kind}:${file.path}`}
          file={file}
          request={request}
        />
      ))}
    </div>
  );
}

export function PromptSystemSection({
  runtimeId,
  onRuntimeIdChange,
}: {
  runtimeId: RuntimeId | null;
  onRuntimeIdChange: (runtimeId: RuntimeId | null) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { agents, isLoading: agentsLoading, update, isMutating } = useAgents();
  const { data: runtimes = [], isLoading: runtimesLoading } = useQuery({
    queryKey: enabledPromptRuntimesQueryKey,
    queryFn: loadEnabledPromptRuntimes,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (runtimeId && runtimes.some((runtime) => runtime.id === runtimeId)) return;
    onRuntimeIdChange(runtimes[0]?.id ?? null);
  }, [onRuntimeIdChange, runtimeId, runtimes]);

  const selectedRuntime = runtimes.find((runtime) => runtime.id === runtimeId) ?? null;
  const runtimeAgents = selectedRuntime
    ? agents.filter((agent) => agent.preferredRuntime === selectedRuntime.id)
    : [];

  const saveAgentPrompt = async (agent: Agent, systemPrompt: string) => {
    await update({
      id: agent.id,
      draft: { ...agentToDraft(agent), systemPrompt },
    });
    toast({ title: t('promptLibrary.system.agentPromptSaved', { name: agent.name }) });
  };

  return (
    <section
      data-slot="prompt-system-section"
      className="mt-10 rounded-lg border border-border bg-background-secondary"
    >
      <div className="flex items-start gap-3 border-b border-border px-4 py-3">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-foreground-muted" />
        <div>
          <h2 className="text-sm font-medium text-foreground">{t('promptLibrary.system.title')}</h2>
          <p className="mt-1 text-xs leading-5 text-foreground-muted">
            {t('promptLibrary.system.description')}
          </p>
        </div>
      </div>

      {runtimesLoading || agentsLoading ? (
        <div className="flex min-h-32 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-foreground-muted" />
        </div>
      ) : runtimes.length === 0 ? (
        <p className="px-4 py-5 text-sm text-foreground-muted">
          {t('promptLibrary.system.noEnabledAgents')}
        </p>
      ) : (
        <div className="p-4">
          <Tabs
            value={selectedRuntime?.id ?? ''}
            onValueChange={(value) => onRuntimeIdChange(value as RuntimeId)}
          >
            <TabsList className="h-auto min-h-7 flex-wrap justify-start">
              {runtimes.map((runtime) => (
                <TabsTab
                  key={runtime.id}
                  value={runtime.id}
                  className="min-h-6 flex-none data-[selected]:bg-background data-[selected]:shadow-sm"
                >
                  {runtime.name}
                </TabsTab>
              ))}
            </TabsList>
          </Tabs>

          {selectedRuntime ? (
            <div className="mt-4 grid gap-5">
              <div>
                <h3 className="text-xs font-medium text-foreground">
                  {t('promptLibrary.system.agentPrompts')}
                </h3>
                <p className="mt-1 text-xs leading-5 text-foreground-muted">
                  {t('promptLibrary.system.agentPromptsDescription', {
                    runtime: selectedRuntime.name,
                  })}
                </p>
                {runtimeAgents.length === 0 ? (
                  <p className="mt-3 rounded-lg border border-dashed border-border px-3 py-4 text-xs text-foreground-muted">
                    {t('promptLibrary.system.noAgentPrompts', {
                      runtime: selectedRuntime.name,
                    })}
                  </p>
                ) : (
                  <div className="mt-3 grid gap-3 @3xl:grid-cols-2">
                    {runtimeAgents.map((agent) => (
                      <AgentSystemPromptEditor
                        key={agent.id}
                        agent={agent}
                        saving={isMutating}
                        onSave={saveAgentPrompt}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-xs font-medium text-foreground">
                  {t('promptLibrary.system.userPrompt')}
                </h3>
                <p className="mt-1 text-xs leading-5 text-foreground-muted">
                  {t('promptLibrary.system.userPromptDescription', {
                    runtime: selectedRuntime.name,
                  })}
                </p>
                <div className="mt-3">
                  <PromptInstructionFilesEditor
                    runtimeId={selectedRuntime.id}
                    projectId={null}
                    scope="user"
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
