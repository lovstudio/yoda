/**
 * Claude Code writes several runtime-authored rows into the transcript using the
 * same shapes as real conversation: background-task notifications arrive as
 * `user` rows, compaction handoffs arrive as `user` rows, and a woken agent that
 * has nothing to say answers with a fixed English sentence. Rendering any of
 * them as conversation misattributes machine bookkeeping to a human, so every
 * reader classifies them here.
 */
const NO_REPLY_NOTICE = /^no response requested\.?$/i;

const TASK_STATUS_LABELS: Record<string, string> = {
  completed: '已完成',
  failed: '失败',
  killed: '已终止',
  stopped: '已停止',
  timeout: '超时',
  running: '仍在运行',
};

export type ClaudeSystemNotice = {
  title: string;
  content: string;
};

/** True for `user` rows the runtime injected on the agent's behalf. */
export function isClaudeInjectedUserRow(row: Record<string, unknown>): boolean {
  if (row.promptSource === 'system') return true;
  const origin = row.origin;
  return (
    !!origin &&
    typeof origin === 'object' &&
    (origin as Record<string, unknown>).kind === 'task-notification'
  );
}

/** True for the fixed sentence a woken agent emits instead of a reply. */
export function isClaudeNoReplyNotice(text: string): boolean {
  return NO_REPLY_NOTICE.test(text.trim());
}

/**
 * Rewrites a background-task notification into readable Chinese. The summary
 * itself is written by the harness in English and is kept verbatim — it is the
 * only place the failure reason appears.
 */
export function describeClaudeTaskNotification(text: string): ClaudeSystemNotice | null {
  if (!/^\s*<task-notification>/.test(text)) return null;
  const taskId = tagValue(text, 'task-id');
  const status = tagValue(text, 'status');
  const summary = tagValue(text, 'summary');
  const statusLabel = status ? (TASK_STATUS_LABELS[status.toLowerCase()] ?? status) : null;
  const headline = ['后台任务', taskId ? `\`${taskId}\`` : null, statusLabel]
    .filter(Boolean)
    .join(' ');
  return {
    title: '任务通知',
    content: summary ? `${headline}\n\n${summary}` : headline,
  };
}

/**
 * Drops the English handoff preamble from a compaction summary. The preamble is
 * addressed to the model, repeats on every compaction, and is the longest line
 * on the page when it leaks into a conversation bubble.
 */
export function stripClaudeCompactSummaryPreamble(text: string): string {
  return text
    .replace(/^\s*This session is being continued from a previous conversation[^\n]*\n+/i, '')
    .replace(/^\s*Summary:\s*\n+/i, '')
    .trim();
}

function tagValue(text: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text);
  const value = match?.[1]?.trim();
  return value ? value : null;
}
