export type MobileTaskEntry = { kind: 'session'; sessionId: string } | { kind: 'task' };

/** Opens the only session directly while keeping multi-session tasks on their task surface. */
export function resolveMobileTaskEntry(sessions: readonly { id: string }[]): MobileTaskEntry {
  return sessions.length === 1 ? { kind: 'session', sessionId: sessions[0].id } : { kind: 'task' };
}
