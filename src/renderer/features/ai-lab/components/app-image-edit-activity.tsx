import { useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  History,
  Loader2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiLabUserApp } from '@shared/ai-lab';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { Progress } from '@renderer/lib/ui/progress';
import { Spinner } from '@renderer/lib/ui/spinner';
import { appImageEditRuntime } from '../app-image-edit-runtime';
import {
  aiLabQueryKeys,
  useAppImageEdit,
  useAppImageEdits,
  useDeleteAppImageEdit,
} from '../use-ai-lab';

export function AppImageEditActivity({ app }: { app: AiLabUserApp }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const history = useAppImageEdits(app.id);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const runtime = useSyncExternalStore(
    (listener) => appImageEditRuntime.subscribe(app.id, listener),
    () => appImageEditRuntime.getSnapshot(app.id)
  );

  useEffect(() => {
    if (runtime.status !== 'succeeded') return;
    void queryClient.invalidateQueries({ queryKey: aiLabQueryKeys.appImageEdits(app.id) });
  }, [app.id, queryClient, runtime.historyId, runtime.status]);

  const count = history.data?.length ?? 0;
  const isRunning = runtime.status === 'running';
  const copyError = async () => {
    if (!runtime.error) return;
    const result = await rpc.app.clipboardWriteText(runtime.error);
    toast({
      title: result.success ? t('common.copied') : t('aiLab.bridgeCopyFailed'),
      variant: result.success ? 'default' : 'destructive',
    });
  };
  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-background px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {isRunning ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
          ) : runtime.status === 'succeeded' ? (
            <CheckCircle2 className="size-3.5 shrink-0 text-success" />
          ) : runtime.status === 'failed' ? (
            <span className="size-2 shrink-0 rounded-full bg-destructive" />
          ) : (
            <Clock3 className="size-3.5 shrink-0 text-foreground-muted" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate text-foreground-muted">
                {runtime.status === 'idle'
                  ? t('aiLab.appImages.historySavedHint')
                  : runtime.status === 'failed'
                    ? t('aiLab.appImages.failed')
                    : runtime.status === 'succeeded'
                      ? t('aiLab.appImages.completed')
                      : t(`aiLab.appImages.stages.${runtime.stage ?? 'preparing'}`)}
              </span>
              {isRunning && (
                <span className="shrink-0 tabular-nums text-foreground-muted">
                  {t('aiLab.appImages.estimatedProgress', { progress: runtime.progress })}
                </span>
              )}
            </div>
            {isRunning && (
              <Progress
                value={runtime.progress}
                aria-label={t('aiLab.appImages.estimatedProgress', { progress: runtime.progress })}
                className="mt-1 gap-0 [&_[data-slot=progress-track]]:h-1"
              />
            )}
          </div>
          {runtime.status === 'failed' && (
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={t('aiLab.appImages.copyError')}
                onClick={() => void copyError()}
              >
                <Copy />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={t('common.dismiss')}
                onClick={() => appImageEditRuntime.reset(app.id)}
              >
                <X />
              </Button>
            </div>
          )}
        </div>
        <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
          <PopoverTrigger
            aria-label={t('aiLab.appImages.history')}
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs text-foreground-muted hover:bg-background-1 hover:text-foreground"
          >
            <History className="size-3.5" />
            {t('aiLab.appImages.history')}
            {count > 0 && <span className="tabular-nums text-foreground-passive">{count}</span>}
          </PopoverTrigger>
          <PopoverContent align="end" className="max-h-[70vh] w-96 gap-3 overflow-y-auto p-3">
            <div>
              <p className="text-sm font-medium">{t('aiLab.appImages.history')}</p>
              <p className="mt-0.5 text-xs text-foreground-muted">
                {t('aiLab.appImages.historyDescription')}
              </p>
            </div>
            {history.isPending ? (
              <div className="flex h-24 items-center justify-center">
                <Spinner className="size-4" />
              </div>
            ) : history.isError ? (
              <div className="rounded-lg border border-border-destructive bg-background-destructive p-3 text-xs text-foreground-destructive">
                {t('aiLab.appImages.historyLoadFailed')}
              </div>
            ) : count === 0 ? (
              <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border text-xs text-foreground-muted">
                {t('aiLab.appImages.emptyHistory')}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {history.data?.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="group overflow-hidden rounded-lg border border-border bg-background text-left outline-none hover:border-border-primary focus-visible:ring-2 focus-visible:ring-ring"
                    title={new Date(item.createdAt).toLocaleString()}
                    onClick={() => {
                      setHistoryOpen(false);
                      setPreviewId(item.id);
                    }}
                  >
                    <img
                      src={item.thumbnailDataUrl}
                      alt={t('aiLab.appImages.historyImageAlt')}
                      className="aspect-square w-full object-cover"
                    />
                    <span className="block truncate px-1.5 py-1 text-[10px] text-foreground-muted">
                      {new Date(item.createdAt).toLocaleString([], {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
      <AppImageEditPreview
        app={app}
        id={previewId}
        isGenerating={isRunning}
        onClose={() => setPreviewId(null)}
        onRegenerated={setPreviewId}
      />
    </>
  );
}

function AppImageEditPreview({
  app,
  id,
  isGenerating,
  onClose,
  onRegenerated,
}: {
  app: AiLabUserApp;
  id: string | null;
  isGenerating: boolean;
  onClose: () => void;
  onRegenerated: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const image = useAppImageEdit(app.id, id);
  const deleteImage = useDeleteAppImageEdit(app.id);
  const [isSaving, setIsSaving] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  const save = async () => {
    if (!id) return;
    setIsSaving(true);
    try {
      const result = await rpc.aiLab.saveAppImageEdit({ appId: app.id, id });
      if (result.saved) toast({ title: t('aiLab.appImages.saved') });
    } catch {
      toast({
        title: t('aiLab.appImages.saveFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const remove = () => {
    if (!id || !window.confirm(t('aiLab.appImages.deleteConfirm'))) return;
    deleteImage.mutate(id, {
      onSuccess: onClose,
      onError: () =>
        toast({
          title: t('aiLab.appImages.deleteFailed'),
          variant: 'destructive',
        }),
    });
  };

  const regenerate = async () => {
    if (!id || isGenerating) return;
    setIsRegenerating(true);
    try {
      const result = await appImageEditRuntime.run(app.id, () =>
        rpc.aiLab.regenerateAppImage({ appId: app.id, id })
      );
      if (result.historyId) onRegenerated(result.historyId);
      toast({ title: t('aiLab.appImages.regenerated') });
    } catch {
      toast({
        title: t('aiLab.appImages.regenerateFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsRegenerating(false);
    }
  };

  const isBusy = isSaving || isRegenerating || isGenerating || deleteImage.isPending;

  return (
    <Dialog open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('aiLab.appImages.previewTitle')}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-64 items-center justify-center overflow-hidden bg-background-secondary p-3">
          {image.isPending || !image.data ? (
            <Spinner className="size-5" />
          ) : (
            <img
              src={image.data.imageDataUrl}
              alt={t('aiLab.appImages.historyImageAlt')}
              className="max-h-[68vh] max-w-full rounded-lg object-contain"
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="destructive" disabled={isBusy || image.isPending} onClick={remove}>
            {deleteImage.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
            {t('aiLab.appImages.delete')}
          </Button>
          <Button
            variant="outline"
            disabled={isBusy || image.isPending}
            onClick={() => void save()}
          >
            {isSaving ? <Loader2 className="animate-spin" /> : <Download />}
            {t('aiLab.appImages.save')}
          </Button>
          <Button disabled={isBusy || image.isPending} onClick={() => void regenerate()}>
            {isRegenerating ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {t(isRegenerating ? 'aiLab.appImages.regenerating' : 'aiLab.appImages.regenerate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
