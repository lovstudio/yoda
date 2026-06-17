/**
 * Agent Communication Protocol (ACP) — the GENERAL way agents collaborate in a
 * Team Room, independent of any one workflow. Agents talk to the room out-of-band
 * by running the `team-at` / `team-status` scripts (they POST to Yoda's hook
 * server), NOT by writing @handles or markers into their normal output. The
 * conductor injects whatever a member is told into that member's live session —
 * so "@ing" a teammate is literally continuing its agent session with new input,
 * which every CLI supports.
 *
 * Collaboration MODES are expressed purely as prompt instructions (see the
 * per-routing addendum in team-rooms/presets.ts): review, fan-out and freeform
 * all run on this one substrate — agents drive every hand-off and decide when to
 * stop (by addressing @you). The conductor adds no per-mode control logic.
 */

/**
 * Placeholder for a member's per-conversation scripts directory. The conductor
 * substitutes it with the real `.yoda/<conversationId>` path when it assembles
 * the member's prompt (the directory isn't known until the session is created).
 */
export const TEAM_SCRIPT_DIR_TOKEN = '__YODA_SCRIPTS_DIR__';
/** Prompt-facing path of the team-at script (resolved per member via the token). */
export const TEAM_AT_SCRIPT = `${TEAM_SCRIPT_DIR_TOKEN}/team-at`;
/** Prompt-facing path of the team-status (progress broadcast) script. */
export const TEAM_STATUS_SCRIPT = `${TEAM_SCRIPT_DIR_TOKEN}/team-status`;

export interface RosterEntry {
  handle: string;
  displayName: string;
  role: string;
}

/**
 * System-prompt fragment teaching an agent how to message the room. Baked into
 * the member's conversation on its first turn.
 */
export function buildTeammateSystemPrompt(args: {
  displayName: string;
  handle: string;
  roster: RosterEntry[];
}): string {
  const others = args.roster.filter((r) => r.handle !== args.handle);
  const roster = others.length
    ? others.map((r) => `  - @${r.handle} — ${r.displayName} (${r.role})`).join('\n')
    : '  (no other agents)';
  const header = [
    `You are "${args.displayName}", handle @${args.handle}, one member of a team working together in this worktree.`,
    `The human lead is @you. Your teammates:`,
    roster,
    ``,
  ];
  return [
    ...header,
    `# Talking to the team`,
    `To send a message to a teammate or the lead, run this command from the worktree root:`,
    ``,
    `  ${TEAM_AT_SCRIPT} <handle> "<your message>"`,
    ``,
    `Examples:`,
    `  ${TEAM_AT_SCRIPT} reviewer "Implemented the parser; ready for review."`,
    `  ${TEAM_AT_SCRIPT} you "Done — all tests pass."`,
    `  ${TEAM_AT_SCRIPT} all "Heads up: I changed the public API."`,
    ``,
    `Rules:`,
    `- This is the ONLY way to reach a teammate. Do NOT write "@handle" in your normal replies — it does nothing.`,
    `- Running it delivers your message straight into that teammate's session (it picks up where you left off).`,
    `- Keep these messages short and concrete — a chat line, not a report. Your full work stays in your own session.`,
    `- When you have finished your part, send the appropriate hand-off with ${TEAM_AT_SCRIPT}, then stop.`,
    ``,
    `To share progress without addressing anyone (a standup update), run:`,
    `  ${TEAM_STATUS_SCRIPT} "<one line on what you're doing>"`,
    `It's broadcast-only — no hand-off. Use it sparingly on longer tasks.`,
  ].join('\n');
}

/** Content delivered into a member's session when it's addressed in the room. */
export function buildMemberTurnPrompt(args: { fromDisplayName: string; body: string }): string {
  return [`Message from ${args.fromDisplayName}:`, args.body].join('\n');
}
