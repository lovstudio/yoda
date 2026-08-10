export const CODEX_INTERRUPTION_SCAN_TAIL_CHARS = 64 * 1024;
const CODEX_INTERRUPTION_RAW_SCAN_CHARS = CODEX_INTERRUPTION_SCAN_TAIL_CHARS * 2;

function stripTerminalControlSequences(value: string): string {
  return value
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\r/g, '');
}

/**
 * Detect Codex's idle interruption screen near the current terminal tail.
 * Limiting the match to the tail prevents an older interrupted turn retained
 * in scrollback from replacing a newer live turn with rollout history.
 */
export function isInterruptedCodexTerminalOutput(value: string): boolean {
  const tail = stripTerminalControlSequences(value.slice(-CODEX_INTERRUPTION_RAW_SCAN_CHARS)).slice(
    -CODEX_INTERRUPTION_SCAN_TAIL_CHARS
  );
  return /Conversation\s+interrupted\s*[–—-]\s*tell\s+the\s+model\s+what\s+to\s+do\s+differently\b/i.test(
    tail
  );
}
