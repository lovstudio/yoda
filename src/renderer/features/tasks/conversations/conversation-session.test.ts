import { describe, expect, it } from 'vitest';
import type { FrontendPty } from '@renderer/lib/pty/pty';
import { shouldAutoResumeConversation } from './conversation-session-utils';

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
});
