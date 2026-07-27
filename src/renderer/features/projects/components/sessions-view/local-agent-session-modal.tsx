import { Import, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalAgentSession } from '@shared/conversations';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { TranscriptLineItem } from '@renderer/features/tasks/components/transcript-line';
import { getTaskManagerStore } from '@renderer/features/tasks/stores/task-selectors';
import {
  normalizeConversationTranscript,
  type ConversationTranscript,
} from '@renderer/features/tasks/transcript-normalization';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogContentArea,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { agentConfig } from '@renderer/utils/agentConfig';
import { log } from '@renderer/utils/logger';

export type LocalAgentSessionModalArgs = {
  projectId: string;
  session: LocalAgentSession;
};

export type LocalAgentSessionModalResult = {
  projectId: string;
  taskId: string;
  conversationId: string;
};

type Props = BaseModalProps<LocalAgentSessionModalResult> & LocalAgentSessionModalArgs;

export function LocalAgentSessionModal({ projectId, session, onClose, onSuccess }: Props) {
  const { t } = useTranslation();
  const [transcript, setTranscript] = useState<ConversationTranscript>();
  const [busy, setBusy] = useState(false);
  const config = agentConfig[session.runtimeId];

  useEffect(() => {
    let cancelled = false;
    rpc.conversations
      .getLocalAgentSessionTranscript(session.catalogId)
      .then((result) => {
        if (!cancelled) setTranscript(normalizeConversationTranscript(result));
      })
      .catch(() => {
        if (!cancelled) setTranscript(normalizeConversationTranscript(null));
      });
    return () => {
      cancelled = true;
    };
  }, [session.catalogId]);

  const handleContinue = async () => {
    if (busy) return;
    const project = asMounted(getProjectStore(projectId));
    const taskManager = getTaskManagerStore(projectId);
    if (!project || !taskManager || project.data.type !== 'local') {
      toast.error(t('projects.sessionsView.addFailed'));
      return;
    }

    setBusy(true);
    const taskId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    try {
      await taskManager.createTask({
        id: taskId,
        projectId,
        name: session.title,
        sourceBranch: { type: 'local', branch: project.data.baseRef },
        strategy: { kind: 'no-worktree' },
        initialConversation: {
          id: conversationId,
          projectId,
          taskId,
          runtime: session.runtimeId,
          title: session.title,
          isInitialConversation: true,
          sessionSource: {
            catalogId: session.catalogId,
            runtimeId: session.runtimeId,
            sessionId: session.sessionId,
            stateRoot: session.stateRoot,
            providerId: session.providerId,
          },
        },
      });
      onSuccess({ projectId, taskId, conversationId });
    } catch (error) {
      log.warn('LocalAgentSessionModal: failed to adopt local session', {
        catalogId: session.catalogId,
        error,
      });
      toast.error(t('projects.sessionsView.addFailed'));
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHeader className="min-w-0 flex-col items-start gap-1.5">
        <DialogTitle className="flex min-w-0 max-w-full items-center gap-2">
          {config ? (
            <AgentLogo
              logo={config.logo}
              alt={config.alt}
              isSvg={config.isSvg}
              invertInDark={config.invertInDark}
              className="size-4 shrink-0"
            />
          ) : null}
          <span className="min-w-0 truncate">{session.title}</span>
        </DialogTitle>
        <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span>{t('projects.sessionsView.localAgentSession')}</span>
          {session.providerId ? <span>{session.providerId}</span> : null}
          {session.updatedAt ? <RelativeTime value={session.updatedAt} compact /> : null}
        </DialogDescription>
      </DialogHeader>
      <DialogContentArea className="gap-0 pt-0">
        {transcript === undefined ? (
          <div className="px-3 py-3 text-xs text-foreground-passive">
            {t('tasks.transcript.loading')}
          </div>
        ) : transcript.lines.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-3 text-xs text-foreground-passive">
            {t('tasks.transcript.empty')}
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-border/60">
            {transcript.totalLines > transcript.lines.length ? (
              <div className="border-b border-border/40 px-3 py-1.5 text-[11px] text-foreground-passive">
                {t('tasks.transcript.earlierLines', {
                  count: transcript.totalLines - transcript.lines.length,
                })}
              </div>
            ) : null}
            {transcript.lines.map((line, index) => {
              const lineNo = transcript.totalLines - transcript.lines.length + index + 1;
              return (
                <TranscriptLineItem key={`${lineNo}:${line.length}`} line={line} lineNo={lineNo} />
              );
            })}
          </div>
        )}
      </DialogContentArea>
      <DialogFooter>
        <Button type="button" disabled={busy} onClick={() => void handleContinue()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Import className="size-4" />}
          {t('projects.sessionsView.addAndContinue')}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
          {t('common.close')}
        </Button>
      </DialogFooter>
    </>
  );
}
