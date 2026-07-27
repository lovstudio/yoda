/**
 * Deterministic PTY session ID.
 *
 * Format: `<projectId>:<scopeId>:<leafId>` where leafId is either a
 * conversationId (agent sessions) or a terminalId (shell sessions).
 *
 * There is at most one active PTY per leaf entity.  Using a deterministic ID
 * means the renderer can subscribe to ptyDataChannel BEFORE calling
 * rpc.conversations.startSession / rpc.terminals.createTerminal — no extra
 * round-trip is needed to learn the session ID.
 */
export function makePtySessionId(projectId: string, scopeId: string, leafId: string): string {
  return `${projectId}:${scopeId}:${leafId}`;
}

export type PtySessionIdParts = {
  projectId: string;
  scopeId: string;
  leafId: string;
};

/**
 * Parse a deterministic PTY id without assuming the leaf id itself contains no
 * colons. Project and scope ids are the two fixed leading segments.
 */
export function parsePtySessionId(sessionId: string): PtySessionIdParts | null {
  const [projectId, scopeId, ...leafParts] = sessionId.split(':');
  const leafId = leafParts.join(':');
  if (!projectId || !scopeId || !leafId) return null;
  return { projectId, scopeId, leafId };
}
