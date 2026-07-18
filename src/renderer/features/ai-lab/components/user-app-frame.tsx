import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiLabUserApp } from '@shared/ai-lab';
import {
  AI_LAB_BRIDGE_CHANNEL,
  AI_LAB_COPY_LAST_ERROR_METHOD,
  parseAiLabBridgeRequest,
  type AiLabBridgeResponse,
} from '@shared/ai-lab-bridge';
import { rpc } from '@renderer/lib/ipc';
import { cn } from '@renderer/utils/utils';
import { appImageEditRuntime } from '../app-image-edit-runtime';
import { normalizeAiLabBridgeError } from '../bridge-error';
import { applySandboxPolicy } from '../sandbox-policy';
import { AppImageEditActivity } from './app-image-edit-activity';

export function UserAppFrame({ app, className }: { app: AiLabUserApp; className?: string }) {
  const { t } = useTranslation();
  const source = useMemo(() => applySandboxPolicy(app.html), [app.html]);
  const iframeRef = useRef<HTMLIFrameElement>(null);

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
      void appImageEditRuntime
        .run(app.id, () => rpc.aiLab.editAppImage({ ...request.payload, appId: app.id }))
        .then((result) => {
          lastBridgeError = null;
          respond({
            channel: AI_LAB_BRIDGE_CHANNEL,
            kind: 'response',
            requestId: request.requestId,
            ok: true,
            result,
          });
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
  }, [app.id, app.name, t]);

  return (
    <div className={cn('flex h-full min-h-[420px] w-full flex-col overflow-hidden', className)}>
      <AppImageEditActivity app={app} />
      <iframe
        ref={iframeRef}
        key={app.updatedAt}
        title={app.name}
        srcDoc={source}
        sandbox="allow-scripts allow-forms allow-modals"
        referrerPolicy="no-referrer"
        className="min-h-0 w-full flex-1 border-0 bg-white"
      />
    </div>
  );
}
