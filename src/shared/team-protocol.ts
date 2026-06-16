/**
 * Teammate chat protocol. Agents talk to the room out-of-band by running the
 * `team-at` script (it POSTs to Yoda's hook server), NOT by writing @handles or
 * markers into their normal output. The conductor injects whatever a member is
 * told into that member's live session — so "@ing" a teammate is literally
 * continuing its agent session with new input, which every CLI supports.
 */

/** Path (relative to the worktree) of the bundled team-at script. */
export const TEAM_AT_SCRIPT = '.yoda/team-at';

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
  return [
    `You are "${args.displayName}", handle @${args.handle}, one member of a team working together in this worktree.`,
    `The human lead is @you. Your teammates:`,
    roster,
    ``,
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
  ].join('\n');
}

/** Content delivered into a member's session when it's addressed in the room. */
export function buildMemberTurnPrompt(args: { fromDisplayName: string; body: string }): string {
  return [`Message from ${args.fromDisplayName}:`, args.body].join('\n');
}
