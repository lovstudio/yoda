import { describe, expect, it } from 'vitest';
import type { FrontendPty } from '@renderer/lib/pty/pty';
import {
  shouldAutoResumeConversation,
  shouldProbeConversationSession,
} from './conversation-session-utils';

describe('shouldAutoResumeConversation', () => {
  it('resumes once for a ready visible PTY and skips the same PTY afterwards', () => {
    const pty = {} as FrontendPty;

    expect(
      shouldAutoResumeConversation({
        isVisible: true,
        sessionId: 'project:task:conversation',
        sessionStatus: 'ready',
        sessionPty: pty,
        lastAutoResumePty: null,
      })
    ).toBe(true);

    expect(
      shouldAutoResumeConversation({
        isVisible: true,
        sessionId: 'project:task:conversation',
        sessionStatus: 'ready',
        sessionPty: pty,
        lastAutoResumePty: pty,
      })
    ).toBe(false);
  });

  it('resumes again when the PTY instance changes even if the session id stays the same', () => {
    const previousPty = {} as FrontendPty;
    const nextPty = {} as FrontendPty;

    expect(
      shouldAutoResumeConversation({
        isVisible: true,
        sessionId: 'project:task:conversation',
        sessionStatus: 'ready',
        sessionPty: nextPty,
        lastAutoResumePty: previousPty,
      })
    ).toBe(true);
  });

  it('does not resume while hidden or before the PTY is ready', () => {
    const pty = {} as FrontendPty;

    expect(
      shouldAutoResumeConversation({
        isVisible: false,
        sessionId: 'project:task:conversation',
        sessionStatus: 'ready',
        sessionPty: pty,
        lastAutoResumePty: null,
      })
    ).toBe(false);

    expect(
      shouldAutoResumeConversation({
        isVisible: true,
        sessionId: 'project:task:conversation',
        sessionStatus: 'connecting',
        sessionPty: pty,
        lastAutoResumePty: null,
      })
    ).toBe(false);
  });

  it('still probes and resumes a PTY with a recoverable renderer snapshot', () => {
    const pty = { hasRecoverableSnapshot: true } as FrontendPty;

    expect(
      shouldAutoResumeConversation({
        isVisible: true,
        sessionId: 'project:task:conversation',
        sessionStatus: 'ready',
        sessionPty: pty,
        lastAutoResumePty: null,
      })
    ).toBe(true);
    expect(
      shouldProbeConversationSession({
        isVisible: true,
        sessionId: 'project:task:conversation',
        sessionStatus: 'ready',
        sessionPty: pty,
      })
    ).toBe(true);
  });

  it('probes a cold ready PTY before its output consumer is established', () => {
    const pty = { hasRecoverableSnapshot: false } as FrontendPty;

    expect(
      shouldProbeConversationSession({
        isVisible: true,
        sessionId: 'project:task:conversation',
        sessionStatus: 'ready',
        sessionPty: pty,
      })
    ).toBe(true);
  });
});
