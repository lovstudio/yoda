import { useCallback } from 'react';
import { getTaskMenuConversation } from '@renderer/features/tasks/components/task-menu-session-info';
import { useProvisionedTaskOrNull } from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import type { MarkdownNoteDraft } from '@renderer/lib/ui/markdown-annotations';

const collapseWhitespace = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * Formats a markdown note for staging in a session's input box.
 *
 * - A leading newline (LF, the terminal's "insert line" — never CR, which would
 *   submit) puts each note on its own line, so consecutive notes stack cleanly
 *   and stay separate from whatever the user typed themselves.
 * - The `[文档批注]` tag plus a delimited quote let the agent tell an annotation
 *   apart from the user's own prompt instead of blurring them together.
 */
export function formatNoteForInput(note: MarkdownNoteDraft): string {
  const parts = [
    note.anchor ? `位置 ${note.anchor}` : null,
    `原文「${collapseWhitespace(note.quote)}」`,
    `备注：${collapseWhitespace(note.comment)}`,
  ].filter(Boolean);
  return `\n[文档批注] ${parts.join(' ｜ ')}`;
}

/** Stages a markdown note into the given PTY session's input line. */
export function syncNoteToSessionInput(sessionId: string, note: MarkdownNoteDraft): void {
  void rpc.pty.sendInput(sessionId, formatNoteForInput(note));
}

/**
 * Returns a callback that stages a markdown note into the active session's
 * input box, or `undefined` when there is no task/session to sync into (e.g.
 * the composer settings popover, which renders the same context rows but isn't
 * "opened from a session"). Targets the task's active/most-recent conversation.
 */
export function useSessionNoteSync(): ((note: MarkdownNoteDraft) => void) | undefined {
  const provisioned = useProvisionedTaskOrNull();
  const conversationId = provisioned ? getTaskMenuConversation(provisioned)?.id : undefined;
  const sync = useCallback(
    (note: MarkdownNoteDraft) => {
      if (!provisioned || !conversationId) return;
      const sessionId =
        provisioned.conversations.conversations.get(conversationId)?.session.sessionId;
      if (!sessionId) return;
      syncNoteToSessionInput(sessionId, note);
    },
    [provisioned, conversationId]
  );
  return provisioned ? sync : undefined;
}
