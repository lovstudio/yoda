import { Camera, Loader2 } from 'lucide-react';
import { domToPng } from 'modern-screenshot';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { MobileSessionTranscriptBlock } from '@shared/mobile-api';
import { getRuntime } from '@shared/runtime-registry';
import { getUserVisibleAgentReplyText } from '@renderer/features/tasks/session-conversation';
import { openFilePath } from '@renderer/lib/components/file-path-operations';
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

  const openScreenshot = useCallback(
    async (filePath: string, reveal: boolean) => {
      try {
        await openFilePath({ absolutePath: filePath, kind: 'file' }, reveal ? 'reveal' : 'open');
      } catch (error) {
        toast({
          title: t(
            reveal
              ? 'workspaceRuntime.replyScreenshotRevealFailed'
              : 'workspaceRuntime.replyScreenshotOpenFailed'
          ),
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
          debugInfo: { filePath, reveal, error },
        });
      }
    },
    [t, toast]
  );

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
      const copied = await rpc.app.clipboardWritePng(dataUrl, detail.sessionTitle);
      if (!copied.success) throw new Error(copied.error);
      const fileName = copied.filePath.split(/[\\/]/).pop() ?? copied.filePath;
      toast.success(
        <ScreenshotToastTitle>{t('workspaceRuntime.replyScreenshotCopied')}</ScreenshotToastTitle>,
        {
          description: <ScreenshotToastFileName>{fileName}</ScreenshotToastFileName>,
          action: {
            label: (
              <ScreenshotToastActionLabel>
                {t('workspaceRuntime.replyScreenshotOpen')}
              </ScreenshotToastActionLabel>
            ),
            onClick: () => void openScreenshot(copied.filePath, false),
          },
          cancel: {
            label: (
              <ScreenshotToastActionLabel>
                {t('workspaceRuntime.replyScreenshotReveal')}
              </ScreenshotToastActionLabel>
            ),
            onClick: () => void openScreenshot(copied.filePath, true),
          },
        }
      );
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
  }, [conversationId, isCapturing, openScreenshot, projectId, t, taskId, toast]);

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

function ScreenshotToastTitle({ children }: { children: ReactNode }) {
  return <span className="font-medium">{children}</span>;
}

function ScreenshotToastFileName({ children }: { children: ReactNode }) {
  return <span className="break-all font-mono text-[11px]">{children}</span>;
}

function ScreenshotToastActionLabel({ children }: { children: ReactNode }) {
  return <span>{children}</span>;
}

function LatestReplyScreenshotCard({
  ref,
  payload,
}: {
  ref: React.Ref<HTMLDivElement>;
  payload: ScreenshotPayload;
}) {
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
      <header className="border-b border-border px-7 pt-6 pb-5">
        <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.22em] uppercase">
          <span className="text-foreground">YODA</span>
          <span className="text-primary-button-background-hover">/</span>
          <span className="text-foreground-passive">{payload.runtimeName}</span>
        </div>
        <h1 className="mt-4 text-[19px] leading-[1.3] font-semibold tracking-[-0.01em] break-words">
          {payload.sessionTitle}
        </h1>
        <div aria-hidden className="mt-4 h-0.5 w-8 bg-primary-button-background" />
      </header>
      <div className="bg-background-1 px-7 py-6">
        <MarkdownRenderer
          annotations={false}
          className="text-[14px] leading-6 break-words [&_h1]:mt-0 [&_h1]:border-0 [&_h1]:pb-0 [&_h1]:text-[19px] [&_h2]:mt-5 [&_h2]:border-0 [&_h2]:pb-0 [&_h2]:text-[16px] [&_h3]:mt-4 [&_h3]:text-[15px] [&_li::marker]:text-primary-button-background-hover [&_li]:my-2 [&_li]:leading-6 [&_ol]:my-4 [&_p]:my-4 [&_p]:leading-6 [&_pre]:max-w-full [&_pre]:overflow-hidden [&_pre]:whitespace-pre-wrap [&_table]:text-[11px] [&_ul]:my-4"
          content={getUserVisibleAgentReplyText(payload.reply.content)}
        />
      </div>
      <footer className="flex items-center justify-end border-t border-border px-7 py-4 text-[10px] text-foreground-passive">
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
