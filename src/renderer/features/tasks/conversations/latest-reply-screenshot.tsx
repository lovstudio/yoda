import { Camera, Loader2 } from 'lucide-react';
import { domToPng } from 'modern-screenshot';
import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { MobileSessionTranscriptBlock } from '@shared/mobile-api';
import { getRuntime } from '@shared/runtime-registry';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';

type ScreenshotPayload = {
  generatedAt: string;
  reply: MobileSessionTranscriptBlock;
  runtimeName: string;
  sessionTitle: string;
};

export function LatestReplyScreenshotButton({
  projectId,
  taskId,
  conversationId,
}: {
  projectId: string;
  taskId: string;
  conversationId: string;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const cardRef = useRef<HTMLDivElement>(null);
  const [payload, setPayload] = useState<ScreenshotPayload | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  const captureLatestReply = useCallback(async () => {
    if (isCapturing) return;
    setIsCapturing(true);
    try {
      const detail = await rpc.sessionShares.getLatestReply(projectId, taskId, conversationId);
      if (!detail.reply) {
        toast.error(t('workspaceRuntime.replyScreenshotEmpty'));
        return;
      }

      setPayload({
        generatedAt: detail.generatedAt,
        reply: detail.reply,
        runtimeName: getRuntime(detail.runtimeId)?.name ?? detail.runtimeId,
        sessionTitle: detail.sessionTitle,
      });
      await waitForScreenshotCard();

      const card = cardRef.current;
      if (!card) throw new Error('Latest reply screenshot card did not render.');
      const dataUrl = await domToPng(card, {
        backgroundColor: getComputedStyle(card).backgroundColor,
        maximumCanvasSize: 32_767,
        scale: 2,
      });
      const copied = await rpc.app.clipboardWritePng(dataUrl);
      if (!copied.success) throw new Error(copied.error);
      toast.success(t('workspaceRuntime.replyScreenshotCopied'));
    } catch (error) {
      toast({
        title: t('workspaceRuntime.replyScreenshotFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
        debugInfo: {
          projectId,
          taskId,
          conversationId,
          error,
        },
      });
    } finally {
      setPayload(null);
      setIsCapturing(false);
    }
  }, [conversationId, isCapturing, projectId, t, taskId, toast]);

  return (
    <>
      <Button
        className="w-full"
        disabled={isCapturing}
        size="sm"
        variant="outline"
        onClick={() => void captureLatestReply()}
      >
        {isCapturing ? <Loader2 className="animate-spin" /> : <Camera />}
        {t(
          isCapturing
            ? 'workspaceRuntime.replyScreenshotCapturing'
            : 'workspaceRuntime.replyScreenshot'
        )}
      </Button>
      {payload && typeof document !== 'undefined'
        ? createPortal(<LatestReplyScreenshotCard ref={cardRef} payload={payload} />, document.body)
        : null}
    </>
  );
}

function LatestReplyScreenshotCard({
  ref,
  payload,
}: {
  ref: React.Ref<HTMLDivElement>;
  payload: ScreenshotPayload;
}) {
  const { t } = useTranslation();
  const capturedAt = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(payload.reply.timestamp ?? payload.generatedAt));

  return (
    <article
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed top-0 -left-[10000px] w-[360px] overflow-hidden bg-background text-foreground"
    >
      <header className="border-b border-border-primary/70 px-6 pt-6 pb-4">
        <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.16em] text-foreground-passive uppercase">
          <span className="size-1.5 rounded-full bg-primary" />
          Yoda · {payload.runtimeName}
        </div>
        <h1 className="mt-3 text-[17px] leading-6 font-semibold break-words">
          {payload.sessionTitle}
        </h1>
      </header>
      <div className="px-6 py-5">
        <MarkdownRenderer
          annotations={false}
          className="text-[14px] leading-6 break-words [&_li]:my-1 [&_ol]:my-3 [&_p]:my-3 [&_pre]:max-w-full [&_pre]:overflow-hidden [&_pre]:whitespace-pre-wrap [&_table]:text-[11px] [&_ul]:my-3"
          content={payload.reply.content}
        />
      </div>
      <footer className="flex items-center justify-between gap-3 border-t border-border-primary/70 px-6 py-4 text-[10px] text-foreground-passive">
        <span>{t('workspaceRuntime.replyScreenshotFooter')}</span>
        <time className="shrink-0 tabular-nums">{capturedAt}</time>
      </footer>
    </article>
  );
}

async function waitForScreenshotCard(): Promise<void> {
  if (typeof document !== 'undefined' && 'fonts' in document) {
    await document.fonts.ready;
  }
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}
