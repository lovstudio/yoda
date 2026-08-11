import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Loader2, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  EditableRuntimeInstructionFile,
  EditableRuntimeInstructionFilesRequest,
} from '@shared/conversations';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { cn } from '@renderer/utils/utils';

export function runtimeInstructionFileVersionsQueryKey(
  request: EditableRuntimeInstructionFilesRequest,
  path: string
) {
  return [
    'promptLibrary',
    'instructionFileVersions',
    request.runtimeId,
    request.projectId ?? null,
    path,
  ] as const;
}

export function PromptInstructionVersionHistory({
  file,
  request,
  compact = false,
  onRestored,
}: {
  file: EditableRuntimeInstructionFile;
  request: EditableRuntimeInstructionFilesRequest;
  compact?: boolean;
  onRestored: (file: EditableRuntimeInstructionFile) => void;
}) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const showConfirm = useShowModal('confirmActionModal');
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const queryKey = runtimeInstructionFileVersionsQueryKey(request, file.path);
  const { data: versions = [], isLoading } = useQuery({
    queryKey,
    enabled: open,
    queryFn: () =>
      rpc.conversations.listRuntimeInstructionFileVersions({
        ...request,
        path: file.path,
      }),
  });
  const restore = useMutation({
    mutationFn: (version: number) =>
      rpc.conversations.restoreRuntimeInstructionFileVersion({
        ...request,
        path: file.path,
        version,
      }),
    onSuccess: (saved, version) => {
      onRestored(saved);
      void queryClient.invalidateQueries({ queryKey });
      toast({ title: t('promptLibrary.system.versionRestored', { version }) });
    },
    onError: (error) =>
      toast({
        title: t('promptLibrary.system.versionRestoreFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      }),
  });

  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(i18n?.language ?? 'zh-CN', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(value));

  const requestRestore = (version: number) => {
    showConfirm({
      title: t('promptLibrary.system.restoreVersionTitle', { version }),
      description: t('promptLibrary.system.restoreVersionDescription'),
      confirmLabel: t('promptLibrary.system.restoreVersionAction'),
      onSuccess: () => restore.mutate(version),
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={t('promptLibrary.system.versionHistory')}
        title={t('promptLibrary.system.versionHistory')}
        className={cn(
          'flex shrink-0 items-center justify-center rounded-md text-foreground-passive outline-none hover:bg-background-1 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring',
          compact ? 'size-6' : 'size-7'
        )}
      >
        <History className={compact ? 'size-3.5' : 'size-4'} />
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={4} className="w-64 gap-2 p-2.5">
        <div className="flex items-center gap-1.5 px-0.5 text-xs font-medium text-foreground">
          <History className="size-3.5 text-foreground-muted" />
          {t('promptLibrary.system.versionHistory')}
        </div>
        {isLoading ? (
          <div className="flex h-16 items-center justify-center">
            <Loader2 className="size-4 animate-spin text-foreground-muted" />
          </div>
        ) : versions.length === 0 ? (
          <p className="px-0.5 py-2 text-xs text-foreground-muted">
            {t('promptLibrary.system.versionEmpty')}
          </p>
        ) : (
          <div className="grid max-h-52 gap-1 overflow-y-auto">
            {versions.map((version) => (
              <div
                key={version.id}
                className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-foreground">
                    {t('promptLibrary.system.versionLabel', { version: version.version })}
                  </div>
                  <div className="text-[10px] text-foreground-passive">
                    {formatDate(version.createdAt)}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={restore.isPending}
                  onClick={() => requestRestore(version.version)}
                >
                  {restore.isPending ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <RotateCcw className="size-3" />
                  )}
                  {t('promptLibrary.system.restoreVersion')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
