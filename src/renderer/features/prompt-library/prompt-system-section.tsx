import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  SquareTerminal,
  UserRound,
} from 'lucide-react';
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
import { FileIcon } from '@renderer/lib/editor/file-icon';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Textarea } from '@renderer/lib/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { cn } from '@renderer/utils/utils';
import { PromptLibraryChapter } from './prompt-library-chapter';

const enabledPromptRuntimesQueryKey = ['promptLibrary', 'enabledRuntimes'] as const;
const standardInstructionClis = ['codex', 'claude'] as const;
const CODEX_OVERRIDE_FILENAME = 'AGENTS.override.md';

function instructionFilename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

function isCodexOverrideFile(file: EditableRuntimeInstructionFile): boolean {
  return instructionFilename(file.path) === CODEX_OVERRIDE_FILENAME;
}

function hasStandardInstructionFiles(runtime: RuntimeDefinition): boolean {
  return standardInstructionClis.some((cli) => runtime.cli === cli);
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
  statusLabel,
  statusMuted = false,
  initiallyExpanded = false,
  compact = false,
}: {
  file: EditableRuntimeInstructionFile;
  request: EditableRuntimeInstructionFilesRequest;
  statusLabel: string;
  statusMuted?: boolean;
  initiallyExpanded?: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(initiallyExpanded);
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
  const filename = instructionFilename(file.path);

  return (
    <div data-slot="runtime-instruction-file" className="border-t border-border first:border-t-0">
      <div className="flex min-w-0 items-center">
        <button
          type="button"
          data-slot="runtime-instruction-file-toggle"
          className={cn(
            'flex min-w-0 flex-1 items-center text-left outline-none hover:bg-background-1 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border',
            compact ? 'gap-1.5 px-2 py-1.5' : 'gap-2 px-3 py-2.5'
          )}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <ChevronRight
            className={cn(
              'shrink-0 text-foreground-muted transition-transform',
              compact ? 'size-3.5' : 'size-4',
              expanded && 'rotate-90'
            )}
          />
          <FileIcon filename={filename} size={compact ? 14 : 16} className="shrink-0" />
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                'block truncate font-medium text-foreground',
                compact ? 'text-xs' : 'text-sm'
              )}
            >
              {filename}
            </span>
            <span
              className="block truncate font-mono text-[10px] text-foreground-passive"
              title={file.path}
            >
              {file.path}
            </span>
          </span>
        </button>
        <Badge
          variant={statusMuted ? 'outline' : 'secondary'}
          className={cn('mr-2 shrink-0', compact && 'px-1.5 py-0 text-[9px]')}
        >
          {statusLabel}
        </Badge>
        {file.exists ? (
          <span className={cn('shrink-0', compact ? 'mr-1' : 'mr-2')}>
            <GlobalFileActionsDropdown absolutePath={file.path} />
          </span>
        ) : null}
      </div>

      {expanded ? (
        <div
          className={cn(
            'border-t border-border bg-background',
            compact ? 'px-2 py-2' : 'px-3 py-3'
          )}
        >
          <Textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={t('promptLibrary.system.filePromptPlaceholder')}
            className={cn(
              'resize-y font-mono leading-relaxed',
              compact ? 'min-h-20 px-2 py-1.5 text-[11px]' : 'min-h-28 text-xs'
            )}
            aria-label={t('promptLibrary.system.filePromptLabel', { name: filename })}
          />
          <div className="mt-2 flex justify-end">
            <Button
              type="button"
              size={compact ? 'xs' : 'sm'}
              disabled={!changed || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? (
                <Loader2 className={cn('animate-spin', compact ? 'size-3.5' : 'size-4')} />
              ) : (
                <Save className={cn(compact ? 'size-3.5' : 'size-4')} />
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
  compact = false,
  initiallyExpanded = false,
}: {
  runtimeId: RuntimeId;
  projectId?: string | null;
  scope: EditableRuntimeInstructionFile['scope'];
  compact?: boolean;
  initiallyExpanded?: boolean;
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
  const overrideFile = scopedFiles.find(isCodexOverrideFile);
  const hasActiveOverride = overrideFile?.exists === true;
  const [revealedOverridePath, setRevealedOverridePath] = useState<string | null>(null);
  const showMissingOverride = overrideFile?.path === revealedOverridePath;

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

  const visibleFiles = scopedFiles.filter(
    (file) => !isCodexOverrideFile(file) || file.exists || showMissingOverride
  );

  return (
    <div className="grid gap-2">
      <div className="overflow-hidden rounded-lg border border-border bg-background-secondary">
        {visibleFiles.map((file) => {
          const isOverride = isCodexOverrideFile(file);
          const isOverriddenBase =
            hasActiveOverride && instructionFilename(file.path) === 'AGENTS.md';
          const statusLabel = !file.exists
            ? t('promptLibrary.system.newFile')
            : isOverride
              ? t('promptLibrary.system.activeOverride')
              : isOverriddenBase
                ? t('promptLibrary.system.overriddenFile')
                : t('promptLibrary.system.activeFile');
          return (
            <PromptInstructionFileEditor
              key={`${file.kind}:${file.path}`}
              file={file}
              request={request}
              statusLabel={statusLabel}
              statusMuted={isOverriddenBase || !file.exists}
              compact={compact}
              initiallyExpanded={
                initiallyExpanded || (isOverride && showMissingOverride && !file.exists)
              }
            />
          );
        })}
      </div>
      {overrideFile && !overrideFile.exists && !showMissingOverride ? (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-foreground-muted"
            onClick={() => setRevealedOverridePath(overrideFile.path)}
          >
            <Plus className="size-4" />
            {t('promptLibrary.system.addTemporaryOverride')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function PromptRuntimeSelector({
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
      data-slot="prompt-runtime-selector"
      className="mt-6"
      aria-labelledby="prompt-runtime-selector-title"
    >
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-y border-border px-1 py-2.5">
        <div className="flex min-w-0 items-start gap-2.5">
          <SquareTerminal className="mt-0.5 size-4 shrink-0 text-foreground-muted" />
          <div className="min-w-0">
            <h2 id="prompt-runtime-selector-title" className="text-sm font-medium text-foreground">
              {t('promptLibrary.runtime.title')}
            </h2>
            <p className="mt-0.5 text-xs leading-5 text-foreground-muted">
              {t('promptLibrary.runtime.description')}
            </p>
          </div>
        </div>
        {isLoading ? (
          <Loader2 className="mr-2 size-4 animate-spin text-foreground-muted" />
        ) : runtimes.length === 0 ? (
          <p className="text-xs text-foreground-muted">
            {t('promptLibrary.system.noEnabledAgents')}
          </p>
        ) : (
          <ToggleGroup
            value={selectedRuntime ? [selectedRuntime.id] : []}
            onValueChange={([value]) => {
              if (value) onRuntimeIdChange(value as RuntimeId);
            }}
            size="sm"
            aria-label={t('promptLibrary.runtime.label')}
          >
            {runtimes.map((runtime) => (
              <ToggleGroupItem key={runtime.id} value={runtime.id} className="px-3">
                {runtime.name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>
    </section>
  );
}

export function UserInstructionSection({ runtimeId }: { runtimeId: RuntimeId | null }) {
  const { t } = useTranslation();
  const selectedRuntime = RUNTIMES.find((runtime) => runtime.id === runtimeId) ?? null;

  return (
    <PromptLibraryChapter
      dataSlot="user-instruction-section"
      className="mt-3"
      icon={UserRound}
      title={t('promptLibrary.system.title')}
      description={
        selectedRuntime
          ? t('promptLibrary.system.description', { runtime: selectedRuntime.name })
          : t('promptLibrary.system.noEnabledAgents')
      }
      bodyClassName="p-3"
    >
      {selectedRuntime ? (
        <div>
          <p className="mb-2 text-xs leading-5 text-foreground-muted">
            {selectedRuntime.cli === 'codex'
              ? t('promptLibrary.system.codexFileDescription')
              : t('promptLibrary.system.userPromptDescription', {
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
    </PromptLibraryChapter>
  );
}
