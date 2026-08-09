import { createProviderClassifier, type ClassificationResult } from './base';

/**
 * Codex's interactive TUI approval is rendered in the PTY instead of the
 * rollout JSONL. Keep this classifier deliberately narrow: rollout remains
 * authoritative for turn boundaries, while this only fills the approval gap.
 */
export function createCodexClassifier() {
  return createProviderClassifier((text: string): ClassificationResult => {
    const tail = text.slice(-1200);

    if (
      /Would you like to run the following command\?/i.test(tail) ||
      /Would you like to make the following edits?\?/i.test(tail) ||
      /Would you like to make the following edit\?/i.test(tail) ||
      /Allow Codex to .*\?/i.test(tail) ||
      /Do you trust the contents .*\?/i.test(tail)
    ) {
      return {
        type: 'notification',
        notificationType: 'permission_prompt',
        message: 'Codex 正在等待你确认执行操作',
      };
    }

    return undefined;
  });
}
