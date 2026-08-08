/**
 * Agent Communication Protocol (ACP) — the general control plane for Team Room
 * collaboration. The conductor can receive persisted room messages, ephemeral
 * hook signals, observed turn completion, or external work-item changes. It
 * injects normalized instructions into a target member's live session, while the
 * substantive work can remain in a transcript, room message, shared file, or
 * GitHub work item.
 *
 * Workflow routing (review, fan-out, sequential, freeform) stays independent of
 * the selected communication mode. `team-at` remains the explicit routing hook;
 * process-observed turns can also hand control back automatically.
 */

import {
  normalizeTeamCommunicationConfig,
  type TeamCommunicationConfig,
} from './team-communication';

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
  communication?: TeamCommunicationConfig;
}): string {
  const communication = normalizeTeamCommunicationConfig(args.communication);
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
  return [...header, ...buildCommunicationInstructions(communication)].join('\n');
}

function buildCommunicationInstructions(config: TeamCommunicationConfig): string[] {
  if (config.mode === 'process') {
    return [
      `# Process-observed collaboration`,
      `Yoda observes your client state and session output. Keep the full work in this session and finish your turn normally.`,
      `You do not need to copy your work into the room. The human can open this session from your status card.`,
      `If you must explicitly hand control to a teammate, send only a short routing signal:`,
      `  ${TEAM_AT_SCRIPT} <handle> "<what they should inspect or do next>"`,
    ];
  }
  if (config.mode === 'shared-file') {
    return [
      `# Shared-file collaboration`,
      `Use ${config.sharedFilePath} as the durable hand-off artifact. Read it before working and update it atomically with your result, decisions, and artifact paths.`,
      `If an immediate explicit hand-off is needed, keep the room signal short and put the substantive work in the shared file:`,
      `  ${TEAM_AT_SCRIPT} <handle> "Updated ${config.sharedFilePath}; continue from the latest hand-off."`,
      `The human can inspect both your session and the shared file without requiring a room transcript.`,
    ];
  }
  if (config.mode === 'github') {
    const repository = config.githubRepository || 'the project GitHub remote';
    const issue = config.githubIssueNumber ? ` issue #${config.githubIssueNumber}` : '';
    const pullRequest = config.githubPullRequestNumber
      ? ` pull request #${config.githubPullRequestNumber}`
      : '';
    return [
      `# GitHub collaboration`,
      `Use ${repository}${issue}${pullRequest} as the durable coordination record. Keep analysis, acceptance decisions, commits, reviews, and completion state on the relevant Issue or Pull Request.`,
      `Yoda watches the configured work items. If an immediate explicit hand-off is needed, send only a concise routing reference:`,
      `  ${TEAM_AT_SCRIPT} <handle> "GitHub updated; inspect the linked Issue or Pull Request."`,
      `Yoda watches configured Issue and Pull Request state locally while this room is active.`,
    ];
  }
  return [
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
  ];
}

/** Content delivered into a member's session when it's addressed in the room. */
export function buildMemberTurnPrompt(args: {
  fromDisplayName: string;
  body: string;
  communication?: TeamCommunicationConfig;
}): string {
  const communication = normalizeTeamCommunicationConfig(args.communication);
  const source =
    communication.mode === 'process'
      ? 'Inspect the relevant teammate session or transcript when context is needed.'
      : communication.mode === 'shared-file'
        ? `Read ${communication.sharedFilePath} before continuing.`
        : communication.mode === 'github'
          ? 'Inspect the configured GitHub Issue or Pull Request before continuing.'
          : null;
  return [`Message from ${args.fromDisplayName}:`, args.body, ...(source ? ['', source] : [])].join(
    '\n'
  );
}
