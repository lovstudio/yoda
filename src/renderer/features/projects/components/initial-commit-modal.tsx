import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, GitCommitHorizontal, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';

export type InitialCommitModalArgs = {
  projectId: string;
  /** Lines describing why a first commit is needed (e.g. "对比模式需要基础提交"). */
  reason: string;
};

type Props = BaseModalProps<void> & InitialCommitModalArgs;

/** Files above this count are flagged — likely an un-ignored payload (node_modules etc.). */
const MANY_FILES_THRESHOLD = 2000;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unitIndex]}`;
}

export function InitialCommitModal({ projectId, reason, onSuccess, onClose }: Props) {
  const { t } = useTranslation();
  const [committing, setCommitting] = useState(false);

  const { data: preview, isPending } = useQuery({
    queryKey: ['initialCommitPreview', projectId],
    queryFn: async () => {
      const result = await rpc.repository.getInitialCommitPreview(projectId);
      if (!result.success) {
        throw new Error('message' in result.error ? result.error.message : 'preview failed');
      }
      return result.data;
    },
    staleTime: 0,
    gcTime: 0,
  });

  const manyFiles = (preview?.fileCount ?? 0) > MANY_FILES_THRESHOLD;

  const handleConfirm = async () => {
    setCommitting(true);
    const result = await rpc.repository.createInitialCommit(projectId);
    setCommitting(false);
    if (!result.success) {
      toast.error(t('initialCommit.failed'));
      return;
    }
    onSuccess();
  };

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>{t('initialCommit.title')}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        <p className="text-sm text-foreground-muted">{reason}</p>
        <p className="text-sm text-foreground-muted">{t('initialCommit.explanation')}</p>

        <div className="mt-1 rounded-md border border-border bg-background-1 p-3">
          {isPending ? (
            <div className="flex items-center gap-2 text-sm text-foreground-muted">
              <Loader2 className="size-4 animate-spin" />
              {t('initialCommit.counting')}
            </div>
          ) : preview ? (
            <div className="flex flex-col gap-1 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-foreground-muted">{t('initialCommit.fileCount')}</span>
                <span className="font-mono text-foreground">{preview.fileCount}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-foreground-muted">{t('initialCommit.totalSize')}</span>
                <span className="font-mono text-foreground">
                  {preview.totalBytes === null
                    ? t('initialCommit.sizeUnknown')
                    : `${preview.approximate ? '≈ ' : ''}${formatBytes(preview.totalBytes)}`}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-foreground-destructive">
              {t('initialCommit.previewFailed')}
            </p>
          )}
        </div>

        {manyFiles && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 ydark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{t('initialCommit.manyFilesWarning')}</span>
          </div>
        )}
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={committing}>
          {t('common.cancel')}
        </Button>
        <Button onClick={() => void handleConfirm()} disabled={isPending || committing}>
          {committing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <GitCommitHorizontal className="size-4" />
          )}
          {t('initialCommit.confirm')}
        </Button>
      </DialogFooter>
    </>
  );
}
