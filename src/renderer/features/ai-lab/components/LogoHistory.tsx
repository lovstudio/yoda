import { Copy, Download, History, ImageOff, RefreshCw, Trash2 } from 'lucide-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LogoGenerationInput, LogoGenerationListItem } from '@shared/ai-lab';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Spinner } from '@renderer/lib/ui/spinner';
import { useDeleteLogoGeneration, useLogoGenerationImage, useLogoGenerations } from '../use-ai-lab';

type PreviewTarget = { item: LogoGenerationListItem; index: number };

export const LogoHistory: React.FC<{
  pendingInput: LogoGenerationInput | null;
  onRerun: (input: LogoGenerationInput) => void;
  rerunDisabled: boolean;
}> = ({ pendingInput, onRerun, rerunDisabled }) => {
  const { t } = useTranslation();
  const { data: items, isLoading } = useLogoGenerations();
  const deleteGeneration = useDeleteLogoGeneration();
  const [preview, setPreview] = useState<PreviewTarget | null>(null);

  const isEmpty = !isLoading && !pendingInput && (items?.length ?? 0) === 0;

  return (
    <section>
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-foreground-muted" />
        <h2 className="text-sm font-semibold">{t('aiLab.logo.history')}</h2>
      </div>

      <div className="mt-3 space-y-4">
        {pendingInput && <PendingCard input={pendingInput} />}

        {isLoading && !pendingInput && (
          <div className="flex items-center justify-center py-10">
            <Spinner className="h-5 w-5" />
          </div>
        )}

        {isEmpty && (
          <EmptyState
            label={t('aiLab.logo.emptyTitle')}
            description={t('aiLab.logo.emptyDescription')}
          />
        )}

        {items?.map((item) => (
          <GenerationCard
            key={item.id}
            item={item}
            onPreview={(index) => setPreview({ item, index })}
            onRerun={() =>
              onRerun({
                brandName: item.brandName,
                description: item.description,
                styleId: item.styleId as LogoGenerationInput['styleId'],
                engine: item.engine,
                model:
                  item.engine === 'zenmux'
                    ? (item.model as LogoGenerationInput['model'])
                    : undefined,
                count: Math.max(1, item.imageCount),
              })
            }
            rerunDisabled={rerunDisabled}
            onDelete={() => deleteGeneration.mutate(item.id)}
          />
        ))}
      </div>

      <PreviewDialog target={preview} onClose={() => setPreview(null)} />
    </section>
  );
};

const PendingCard: React.FC<{ input: LogoGenerationInput }> = ({ input }) => {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-border bg-background-secondary p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Spinner className="h-4 w-4" />
        <span className="truncate">{input.brandName}</span>
        <span className="text-xs font-normal text-muted-foreground">
          {t('aiLab.logo.generating')}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {Array.from({ length: input.count }, (_, index) => (
          <div key={index} className="aspect-square animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    </div>
  );
};

const GenerationCard: React.FC<{
  item: LogoGenerationListItem;
  onPreview: (index: number) => void;
  onRerun: () => void;
  rerunDisabled: boolean;
  onDelete: () => void;
}> = ({ item, onPreview, onRerun, rerunDisabled, onDelete }) => {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-border bg-background-secondary p-4">
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-medium">{item.brandName}</span>
        <Badge variant="outline" className="shrink-0 text-[10px]">
          {t(`aiLab.logo.styles.${item.styleId}`, { defaultValue: item.styleId })}
        </Badge>
        <Badge variant="outline" className="shrink-0 text-[10px]">
          {item.model}
        </Badge>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          <RelativeTime value={item.createdAt} ago />
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={t('aiLab.logo.rerun')}
          title={t('aiLab.logo.rerun')}
          disabled={rerunDisabled}
          onClick={onRerun}
        >
          <RefreshCw />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={t('aiLab.logo.delete')}
          title={t('aiLab.logo.delete')}
          className="text-muted-foreground hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 />
        </Button>
      </div>

      {item.status === 'failed' ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <ImageOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="break-all">{item.error ?? t('aiLab.logo.failed')}</span>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-4 gap-2">
          {item.thumbnails.map((thumbnail, index) =>
            thumbnail ? (
              <button
                key={index}
                type="button"
                onClick={() => onPreview(index)}
                className="group overflow-hidden rounded-lg border border-border bg-background transition-colors hover:border-accent"
              >
                <img
                  src={thumbnail}
                  alt={`${item.brandName} logo ${index + 1}`}
                  className="aspect-square w-full object-cover transition-transform group-hover:scale-[1.03]"
                />
              </button>
            ) : (
              <div
                key={index}
                className="flex aspect-square items-center justify-center rounded-lg border border-border bg-muted"
              >
                <ImageOff className="h-4 w-4 text-muted-foreground" />
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
};

const PreviewDialog: React.FC<{
  target: PreviewTarget | null;
  onClose: () => void;
}> = ({ target, onClose }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: imageUrl, isLoading } = useLogoGenerationImage(
    target?.item.id ?? null,
    target?.index ?? null
  );

  const handleSave = async () => {
    if (!target) return;
    try {
      const result = await rpc.aiLab.saveGenerationImage({
        id: target.item.id,
        index: target.index,
      });
      if (result.saved) toast({ title: t('aiLab.logo.saved') });
    } catch (error) {
      toast({
        title: t('aiLab.logo.saveFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const handleCopy = async () => {
    if (!target) return;
    try {
      await rpc.aiLab.copyGenerationImage({ id: target.item.id, index: target.index });
      toast({ title: t('aiLab.logo.copied') });
    } catch (error) {
      toast({
        title: t('aiLab.logo.copyFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="truncate">{target?.item.brandName}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-center rounded-lg border border-border bg-background p-2">
          {isLoading || !imageUrl ? (
            <div className="flex aspect-square w-full items-center justify-center">
              <Spinner className="h-5 w-5" />
            </div>
          ) : (
            <img
              src={imageUrl}
              alt={target?.item.brandName ?? ''}
              className="max-h-[60vh] w-full rounded-md object-contain"
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => void handleCopy()}>
            <Copy className="h-4 w-4" />
            {t('aiLab.logo.copy')}
          </Button>
          <Button onClick={() => void handleSave()}>
            <Download className="h-4 w-4" />
            {t('aiLab.logo.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
