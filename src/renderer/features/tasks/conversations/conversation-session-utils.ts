import type { FrontendPty } from '@renderer/lib/pty/pty';

export function shouldAutoResumeConversation({
  isVisible,
  sessionId,
  sessionStatus,
  sessionPty,
  lastAutoResumePty,
}: {
  isVisible: boolean;
  sessionId: string | null;
  sessionStatus: string | undefined;
  sessionPty: FrontendPty | null;
  lastAutoResumePty: FrontendPty | null;
}): boolean {
  return Boolean(
    isVisible &&
      sessionId &&
      sessionStatus === 'ready' &&
      sessionPty &&
      sessionPty !== lastAutoResumePty
  );
}
