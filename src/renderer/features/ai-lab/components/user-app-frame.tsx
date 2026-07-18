import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiLabUserApp } from '@shared/ai-lab';
import {
  AI_LAB_BRIDGE_CHANNEL,
  parseAiLabBridgeRequest,
  type AiLabBridgeResponse,
} from '@shared/ai-lab-bridge';
import { rpc } from '@renderer/lib/ipc';
import { cn } from '@renderer/utils/utils';
import { applySandboxPolicy } from '../sandbox-policy';

export function UserAppFrame({ app, className }: { app: AiLabUserApp; className?: string }) {
  const { t } = useTranslation();
  const source = useMemo(() => applySandboxPolicy(app.html), [app.html]);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let permissionGranted = false;
    let activeRequestId: string | null = null;

    const respond = (response: AiLabBridgeResponse) => {
      iframeRef.current?.contentWindow?.postMessage(response, '*');
    };

    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const request = parseAiLabBridgeRequest(event.data);
      if (!request) return;

      if (activeRequestId) {
        respond({
          channel: AI_LAB_BRIDGE_CHANNEL,
          kind: 'response',
          requestId: request.requestId,
          ok: false,
          error: t('aiLab.bridgeBusy'),
        });
        return;
      }

      if (!permissionGranted) {
        permissionGranted = window.confirm(t('aiLab.bridgePermissionConfirm', { name: app.name }));
        if (!permissionGranted) {
          respond({
            channel: AI_LAB_BRIDGE_CHANNEL,
            kind: 'response',
            requestId: request.requestId,
            ok: false,
            error: t('aiLab.bridgePermissionDenied'),
          });
          return;
        }
      }

      activeRequestId = request.requestId;
      void rpc.aiLab
        .editAppImage({ ...request.payload, appId: app.id })
        .then((result) => {
          respond({
            channel: AI_LAB_BRIDGE_CHANNEL,
            kind: 'response',
            requestId: request.requestId,
            ok: true,
            result,
          });
        })
        .catch((error: unknown) => {
          respond({
            channel: AI_LAB_BRIDGE_CHANNEL,
            kind: 'response',
            requestId: request.requestId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
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
    <iframe
      ref={iframeRef}
      key={app.updatedAt}
      title={app.name}
      srcDoc={source}
      sandbox="allow-scripts allow-forms allow-modals"
      referrerPolicy="no-referrer"
      className={cn(
        'h-full min-h-[420px] w-full rounded-xl border border-border bg-white shadow-sm',
        className
      )}
    />
  );
}
