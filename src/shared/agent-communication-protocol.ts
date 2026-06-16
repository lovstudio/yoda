/**
 * Agent Communication Protocol (ACP) — the GENERAL way agents collaborate in a
 * Team Room, independent of any one workflow. Agents talk to the room out-of-band
 * by running the `team-at` / `team-status` scripts (they POST to Yoda's hook
 * server), NOT by writing @handles or markers into their normal output. The
 * conductor injects whatever a member is told into that member's live session —
 * so "@ing" a teammate is literally continuing its agent session with new input,
 * which every CLI supports.
 *
 * Specific collaboration MODES build on this: e.g. the review loop (implement ↔
 * review) lives in `review-protocol.ts`, fan-out and freeform are other modes.
 * Review is just one typical mode — this protocol is the substrate they share.
 */

/** Path (relative to the worktree) of the bundled team-at script. */
export const TEAM_AT_SCRIPT = '.yoda/team-at';
/** Path (relative to the worktree) of the bundled team-status (progress broadcast) script. */
export const TEAM_STATUS_SCRIPT = '.yoda/team-status';
/** Path (relative to the worktree) of the bundled team-verdict (structured PASS/FAIL) script. */
export const TEAM_VERDICT_SCRIPT = '.yoda/team-verdict';

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
  /** Preset-driven loops (e.g. review-loop) where the conductor routes hand-offs, so the member must NOT call team-at. */
  autoRouted?: boolean;
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
  if (args.autoRouted) {
    return [
      ...header,
      `# How this team works`,
      `This team runs an automatic loop. You do NOT message teammates yourself — when you finish your`,
      `turn, the system automatically hands off to the right teammate and brings their reply back to you.`,
      `Just do your part and finish. Do NOT write "@handle" in your replies and do NOT run any hand-off`,
      `command — follow the routing instructions below for exactly how to end your turn.`,
      ``,
      `# Talk to the room in your own voice`,
      `The room is a group chat the human is watching. Speak for yourself — naturally, in your own`,
      `words — by running:`,
      ``,
      `  ${TEAM_STATUS_SCRIPT} "<one short, human line>"`,
      ``,
      `- The MOMENT you start your turn, say what you're about to do (e.g. "Sure — let me dig into the`,
      `  parser and see what's breaking."). Make it sound like you, not a template.`,
      `- Drop a brief line at meaningful milestones, and a one-line wrap-up when you finish.`,
      `- Keep each to ONE sentence. Your detailed work stays in your session; this is just the chat.`,
      `This is broadcast-only — it never hands off your turn or changes the routing.`,
    ].join('\n');
  }
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
