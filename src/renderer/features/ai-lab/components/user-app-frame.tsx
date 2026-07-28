import { Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiLabUserApp } from '@shared/ai-lab';
import {
  AI_LAB_BRIDGE_CHANNEL,
  AI_LAB_COPY_LAST_ERROR_METHOD,
  parseAiLabBridgeRequest,
  type AiLabBridgeResponse,
} from '@shared/ai-lab-bridge';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { cn } from '@renderer/utils/utils';
import { appUsesImageEditBridge } from '../app-capabilities';
import { AI_LAB_APP_FRAME_SANDBOX, AI_LAB_PROJECT_APP_FRAME_SANDBOX } from '../app-frame-sandbox';
import { appImageEditRuntime } from '../app-image-edit-runtime';
import { normalizeAiLabBridgeError } from '../bridge-error';
import { applySandboxPolicy } from '../sandbox-policy';
import { useAiLabAppPreview } from '../use-ai-lab';
import { AppImageEditActivity } from './app-image-edit-activity';

export function UserAppFrame({ app, className }: { app: AiLabUserApp; className?: string }) {
  const { t } = useTranslation();
  const isProjectApp = app.runtimeKind === 'react-vite';
  const source = useMemo(() => applySandboxPolicy(app.html), [app.html]);
  const preview = useAiLabAppPreview(app, isProjectApp);
  const usesImageEditBridge = useMemo(
    () =>
      isProjectApp
        ? (app.capabilities ?? []).includes('ai.image.edit')
        : appUsesImageEditBridge(app.html),
    [app.capabilities, app.html, isProjectApp]
  );
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const generationNoteRef = useRef('');
  const [generationNote, setGenerationNote] = useState('');
  const updateGenerationNote = useCallback((note: string) => {
    generationNoteRef.current = note;
    setGenerationNote(note);
  }, []);

  useEffect(() => {
    let permissionGranted = false;
    let activeRequestId: string | null = null;
    let lastBridgeError: string | null = null;

    const respond = (response: AiLabBridgeResponse) => {
      iframeRef.current?.contentWindow?.postMessage(response, '*');
    };

    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const request = parseAiLabBridgeRequest(event.data);
      if (!request) return;

      if (request.method === AI_LAB_COPY_LAST_ERROR_METHOD) {
        if (!lastBridgeError) {
          respond({
            channel: AI_LAB_BRIDGE_CHANNEL,
            kind: 'response',
            requestId: request.requestId,
            ok: false,
            error: t('aiLab.bridgeNoErrorToCopy'),
          });
          return;
        }
        void rpc.app.clipboardWriteText(lastBridgeError).then((result) => {
          respond(
            result.success
              ? {
                  channel: AI_LAB_BRIDGE_CHANNEL,
                  kind: 'response',
                  requestId: request.requestId,
                  ok: true,
                  result: { copied: true },
                }
              : {
                  channel: AI_LAB_BRIDGE_CHANNEL,
                  kind: 'response',
                  requestId: request.requestId,
                  ok: false,
                  error: result.error || t('aiLab.bridgeCopyFailed'),
                }
          );
        });
        return;
      }

      if (activeRequestId) {
        lastBridgeError = t('aiLab.bridgeBusy');
        respond({
          channel: AI_LAB_BRIDGE_CHANNEL,
          kind: 'response',
          requestId: request.requestId,
          ok: false,
          error: lastBridgeError,
        });
        return;
      }

      if (appImageEditRuntime.getSnapshot(app.id).status === 'running') {
        lastBridgeError = t('aiLab.bridgeBusy');
        respond({
          channel: AI_LAB_BRIDGE_CHANNEL,
          kind: 'response',
          requestId: request.requestId,
          ok: false,
          error: lastBridgeError,
        });
        return;
      }

      if (!permissionGranted) {
        permissionGranted = window.confirm(t('aiLab.bridgePermissionConfirm', { name: app.name }));
        if (!permissionGranted) {
          lastBridgeError = t('aiLab.bridgePermissionDenied');
          respond({
            channel: AI_LAB_BRIDGE_CHANNEL,
            kind: 'response',
            requestId: request.requestId,
            ok: false,
            error: lastBridgeError,
          });
          return;
        }
      }

      activeRequestId = request.requestId;
      const userNote = generationNoteRef.current.trim();
      void appImageEditRuntime
        .run(app.id, () =>
          rpc.aiLab.editAppImage({
            ...request.payload,
            appId: app.id,
            userNote: userNote || undefined,
          })
        )
        .then((result) => {
          lastBridgeError = null;
          respond({
            channel: AI_LAB_BRIDGE_CHANNEL,
            kind: 'response',
            requestId: request.requestId,
            ok: true,
            result,
          });
          if (userNote) updateGenerationNote('');
        })
        .catch((error: unknown) => {
          const message = normalizeAiLabBridgeError(error);
          lastBridgeError = message;
          respond({
            channel: AI_LAB_BRIDGE_CHANNEL,
            kind: 'response',
            requestId: request.requestId,
            ok: false,
            error: message,
          });
        })
        .finally(() => {
          if (activeRequestId === request.requestId) activeRequestId = null;
        });
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [app.id, app.name, t, updateGenerationNote]);

  const previewUrl = isProjectApp && preview.data?.kind === 'url' ? preview.data.url : undefined;

  return (
    <div className={cn('flex h-full min-h-[420px] w-full flex-col overflow-hidden', className)}>
      {usesImageEditBridge && (
        <AppImageEditActivity
          app={app}
          generationNote={generationNote}
          onGenerationNoteChange={updateGenerationNote}
        />
      )}
      {isProjectApp && preview.isPending ? (
        <AppFrameState>
          <Loader2 className="size-5 animate-spin" />
          <span>{t('aiLab.previewStarting')}</span>
        </AppFrameState>
      ) : isProjectApp && (preview.isError || !previewUrl) ? (
        <AppFrameState>
          <span>{t('aiLab.previewFailed')}</span>
          {preview.error instanceof Error && (
            <span className="max-w-xl whitespace-pre-wrap text-xs text-foreground-passive">
              {preview.error.message}
            </span>
          )}
          <Button size="sm" variant="outline" onClick={() => void preview.refetch()}>
            <RefreshCw />
            {t('common.retry')}
          </Button>
        </AppFrameState>
      ) : (
        <iframe
          ref={iframeRef}
          key={app.updatedAt}
          title={app.name}
          {...(previewUrl ? { src: previewUrl } : { srcDoc: source })}
          sandbox={previewUrl ? AI_LAB_PROJECT_APP_FRAME_SANDBOX : AI_LAB_APP_FRAME_SANDBOX}
          referrerPolicy="no-referrer"
          className="min-h-0 w-full flex-1 border-0 bg-white"
        />
      )}
    </div>
  );
}

function AppFrameState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-background px-6 text-center text-sm text-foreground-muted">
      {children}
    </div>
  );
}
