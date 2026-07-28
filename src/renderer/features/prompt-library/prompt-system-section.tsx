import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, FileText, Loader2, RefreshCw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RuntimeCustomConfigs } from '@shared/app-settings';
import type {
  EditableRuntimeInstructionFile,
  EditableRuntimeInstructionFilesRequest,
} from '@shared/conversations';
import type { DependencyStatusMap } from '@shared/dependencies';
import { RUNTIMES, type RuntimeDefinition, type RuntimeId } from '@shared/runtime-registry';
import { GlobalFileActionsDropdown } from '@renderer/lib/components/file-path-actions';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Tabs, TabsList, TabsTab } from '@renderer/lib/ui/tabs';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';

const enabledPromptRuntimesQueryKey = ['promptLibrary', 'enabledRuntimes'] as const;

function hasStandardInstructionFiles(runtime: RuntimeDefinition): boolean {
  return runtime.cli === 'claude' || runtime.cli === 'codex';
}

export async function loadEnabledPromptRuntimes(): Promise<RuntimeDefinition[]> {
  await rpc.dependencies.probeCategory('agent');
  const [dependencies, runtimeConfigs] = await Promise.all([
    rpc.dependencies.getAll() as Promise<DependencyStatusMap>,
    rpc.runtimeSettings.getAll() as Promise<RuntimeCustomConfigs>,
  ]);
  return RUNTIMES.filter(
    (runtime) =>
      hasStandardInstructionFiles(runtime) &&
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
  const [expanded, setExpanded] = useState(false);
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
    <div data-slot="runtime-instruction-file" className="border-t border-border first:border-t-0">
      <div className="flex min-w-0 items-center">
        <button
          type="button"
          data-slot="runtime-instruction-file-toggle"
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left outline-none hover:bg-background-1 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <ChevronRight
            className={cn(
              'size-4 shrink-0 text-foreground-muted transition-transform',
              expanded && 'rotate-90'
            )}
          />
          <FileText className="size-4 shrink-0 text-foreground-muted" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">{filename}</span>
            <span
              className="block truncate font-mono text-[10px] text-foreground-passive"
              title={file.path}
            >
              {file.path}
            </span>
          </span>
        </button>
        <Badge variant="secondary" className="mr-2 shrink-0">
          {file.exists ? t('promptLibrary.system.existingFile') : t('promptLibrary.system.newFile')}
        </Badge>
        {file.exists ? (
          <span className="mr-2 shrink-0">
            <GlobalFileActionsDropdown absolutePath={file.path} />
          </span>
        ) : null}
      </div>

      {expanded ? (
        <div className="border-t border-border bg-background px-3 py-3">
          <Textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={t('promptLibrary.system.filePromptPlaceholder')}
            className="min-h-28 resize-y font-mono text-xs leading-relaxed"
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
      ) : null}
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
  const {
    data: files = [],
    error,
    isError,
    isFetching,
    isLoading,
    refetch,
  } = useEditableInstructionFiles(request);
  const scopedFiles = files.filter((file) => file.scope === scope);

  if (isLoading) {
    return (
      <div className="flex min-h-16 items-center justify-center">
        <Loader2 className="size-4 animate-spin text-foreground-muted" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5">
        <p className="min-w-0 flex-1 text-xs text-destructive">
          {t('promptLibrary.system.fileLoadFailed', {
            detail: error instanceof Error ? error.message : String(error),
          })}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          {isFetching ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          {t('common.retry')}
        </Button>
      </div>
    );
  }

  if (scopedFiles.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-foreground-muted">
        {t('promptLibrary.system.noInstructionFiles')}
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
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
  const { data: runtimes = [], isLoading } = useQuery({
    queryKey: enabledPromptRuntimesQueryKey,
    queryFn: loadEnabledPromptRuntimes,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (runtimeId && runtimes.some((runtime) => runtime.id === runtimeId)) return;
    onRuntimeIdChange(runtimes[0]?.id ?? null);
  }, [onRuntimeIdChange, runtimeId, runtimes]);

  const selectedRuntime = runtimes.find((runtime) => runtime.id === runtimeId) ?? null;

  return (
    <section
      data-slot="prompt-system-section"
      className="mt-10 rounded-lg border border-border bg-background-secondary"
    >
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium text-foreground">{t('promptLibrary.system.title')}</h2>
        <p className="mt-1 text-xs leading-5 text-foreground-muted">
          {t('promptLibrary.system.description')}
        </p>
      </div>

      {isLoading ? (
        <div className="flex min-h-24 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-foreground-muted" />
        </div>
      ) : runtimes.length === 0 ? (
        <p className="px-4 py-4 text-sm text-foreground-muted">
          {t('promptLibrary.system.noEnabledAgents')}
        </p>
      ) : (
        <div className="p-3">
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
            <div className="mt-3">
              <p className="mb-2 text-xs leading-5 text-foreground-muted">
                {t('promptLibrary.system.userPromptDescription', {
                  runtime: selectedRuntime.name,
                })}
              </p>
              <PromptInstructionFilesEditor
                runtimeId={selectedRuntime.id}
                projectId={null}
                scope="user"
              />
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
