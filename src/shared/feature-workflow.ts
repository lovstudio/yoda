import { TEAM_AT_SCRIPT } from './agent-communication-protocol';
import type { RoomMember, RoomMessage } from './team-room';

/** Stable identity for the built-in end-to-end feature-development team. */
export const BUILTIN_FEATURE_TEAM_ID = 'builtin:feature';

/** Stored on Team Rooms so the renderer can show the feature-specific workflow UI. */
export const FEATURE_WORKFLOW_ROOM_PRESET = 'feature-workflow' as const;

export const FEATURE_WORKFLOW_STAGES = [
  { id: 'problem', handle: 'orchestrator', number: '01' },
  { id: 'product-design', handle: 'product-design', number: '02' },
  { id: 'implementation', handle: 'engineering', number: '03' },
  { id: 'validation', handle: 'quality', number: '04' },
  { id: 'feature-docs', handle: 'feature-docs', number: '05' },
  { id: 'launch-docs', handle: 'launch-docs', number: '06' },
] as const;

export type FeatureWorkflowStageId = (typeof FEATURE_WORKFLOW_STAGES)[number]['id'];
export type FeatureWorkflowGateVerdict = 'pass' | 'blocked';

export type FeatureWorkflowStageSignal = {
  stageId: FeatureWorkflowStageId;
  verdict: FeatureWorkflowGateVerdict;
  detail: string;
};

export type FeatureWorkflowStageStatus = 'pending' | 'active' | 'completed' | 'blocked';

export type FeatureWorkflowStageProgress = {
  stage: (typeof FEATURE_WORKFLOW_STAGES)[number];
  status: FeatureWorkflowStageStatus;
  detail: string;
  member: RoomMember | null;
};

const STAGE_IDS = new Set<string>(FEATURE_WORKFLOW_STAGES.map((stage) => stage.id));
const FEATURE_SIGNAL_RE = /^\s*\[FEATURE:([a-z-]+):(pass|blocked)\]\s*/i;
const FEATURE_SIGNAL_ANY_RE = /\[FEATURE:[a-z-]+:(?:pass|blocked)\]/i;
const PASS_REQUIRED_FIELDS: Record<FeatureWorkflowStageId, readonly string[]> = {
  problem: ['Brief', 'success'],
  'product-design': ['Artifacts', 'Decisions', 'Gate'],
  implementation: ['Artifacts', 'Evidence', 'Risks'],
  validation: ['Evidence', 'Coverage', 'Risks'],
  'feature-docs': ['Artifacts', 'Evidence', 'Coverage'],
  'launch-docs': ['Artifacts', 'Evidence', 'External action'],
};

function hasStructuredField(detail: string, field: string): boolean {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[;\\n])\\s*${escaped}:\\s*\\S`, 'i').test(detail);
}

/**
 * Parse the durable gate marker that feature agents put in Team Room hand-offs.
 * The surrounding text stays human-readable and carries artifact paths/evidence.
 */
export function parseFeatureWorkflowStageSignal(body: string): FeatureWorkflowStageSignal | null {
  const match = FEATURE_SIGNAL_RE.exec(body);
  if (!match) return null;
  const stageId = match[1]?.toLowerCase();
  const verdict = match[2]?.toLowerCase();
  if (!stageId || !STAGE_IDS.has(stageId)) return null;
  if (verdict !== 'pass' && verdict !== 'blocked') return null;
  const detail = body.slice(match[0].length).trim();
  if (!detail || FEATURE_SIGNAL_ANY_RE.test(detail)) return null;
  const requiredFields =
    verdict === 'blocked'
      ? ['Blocker', 'Needed']
      : PASS_REQUIRED_FIELDS[stageId as FeatureWorkflowStageId];
  if (!requiredFields.every((field) => hasStructuredField(detail, field))) return null;
  return {
    stageId: stageId as FeatureWorkflowStageId,
    verdict,
    detail,
  };
}

/**
 * Rebuild the workflow after a reload from durable hand-off messages. Signals
 * are accepted strictly in stage order. Re-passing an earlier stage invalidates
 * its downstream gates, which keeps changed design/code from looking green.
 * Live member state may highlight a legitimate current/rework stage, but never
 * unlocks a future stage by itself.
 */
function reduceFeatureWorkflowProgress(
  members: RoomMember[],
  messages: RoomMessage[],
  includeLiveState: boolean
): FeatureWorkflowStageProgress[] {
  const states: Array<Pick<FeatureWorkflowStageProgress, 'status' | 'detail'>> =
    FEATURE_WORKFLOW_STAGES.map(() => ({ status: 'pending', detail: '' }));
  const stageIndex = new Map(FEATURE_WORKFLOW_STAGES.map((stage, index) => [stage.id, index]));
  const memberById = new Map(members.map((member) => [member.id, member]));
  let currentIndex = 0;

  for (const message of messages) {
    if (message.kind !== 'handoff') continue;
    const signal = parseFeatureWorkflowStageSignal(message.body);
    if (!signal) continue;
    const index = stageIndex.get(signal.stageId);
    if (index === undefined || index > currentIndex) continue;
    const stage = FEATURE_WORKFLOW_STAGES[index];
    const author = message.authorMemberId ? memberById.get(message.authorMemberId) : null;
    const expectedMention =
      signal.stageId === 'problem'
        ? signal.verdict === 'pass'
          ? 'product-design'
          : 'you'
        : 'orchestrator';
    if (!stage || author?.handle !== stage.handle || !message.mentions.includes(expectedMention)) {
      continue;
    }

    if (signal.verdict === 'blocked') {
      for (let i = index; i < states.length; i++) states[i] = { status: 'pending', detail: '' };
      states[index] = { status: 'blocked', detail: signal.detail };
      currentIndex = index;
      continue;
    }

    // A newly passed upstream artifact makes all later evidence stale.
    if (index < currentIndex) {
      for (let i = index + 1; i < states.length; i++) {
        states[i] = { status: 'pending', detail: '' };
      }
    }
    states[index] = { status: 'completed', detail: signal.detail };
    currentIndex = index + 1;
  }

  if (currentIndex < states.length && states[currentIndex]?.status === 'pending') {
    states[currentIndex] = { ...states[currentIndex], status: 'active' };
  }

  const memberByHandle = new Map(members.map((member) => [member.handle, member]));
  return FEATURE_WORKFLOW_STAGES.map((stage, index) => {
    const member = memberByHandle.get(stage.handle) ?? null;
    let state = states[index];
    // The orchestrator owns only the initial problem gate. Its later turns are
    // coordination and must not make stage 01 look active again.
    const runtimeCanOverride = stage.id !== 'problem' || currentIndex === 0;
    if (includeLiveState && runtimeCanOverride && member && index <= currentIndex) {
      if (member.status === 'running' || member.status === 'waiting') {
        state = { ...state, status: 'active' };
      } else if (member.status === 'awaiting-input' || member.status === 'error') {
        state = { ...state, status: 'blocked' };
      }
    }
    return { stage, ...state, member };
  });
}

export function deriveFeatureWorkflowProgress(
  members: RoomMember[],
  messages: RoomMessage[]
): FeatureWorkflowStageProgress[] {
  return reduceFeatureWorkflowProgress(members, messages, true);
}

/**
 * Runtime routing guard for Feature rooms. The message is already part of the
 * supplied history, so a valid gate hand-off can unlock its next owner. Humans
 * may talk to the lead/current or completed stages; the orchestrator may assign
 * only unlocked stages; workers may report only to the orchestrator.
 */
export function featureWorkflowAllowedTargetHandles(
  members: RoomMember[],
  messages: RoomMessage[],
  message: RoomMessage
): string[] {
  // A Feature hand-off is deliberately singular. Reject broadcasts and any
  // multi-target message even when every named stage has been unlocked.
  if (message.mentions.length !== 1 || message.mentions.includes('all')) return [];
  const author = message.authorMemberId
    ? members.find((member) => member.id === message.authorMemberId)
    : null;
  if (!author) return [];

  // Routing authorization must ignore transient runtime status. The author is
  // still `running` while team-at posts its durable marker; letting live state
  // override that marker would reject a valid blocker escalation or completion.
  const progress = reduceFeatureWorkflowProgress(members, messages, false);
  const unlocked = new Set<string>(
    progress.filter((stage) => stage.status !== 'pending').map((stage) => stage.stage.handle)
  );

  if (!author.runtime) {
    // The human can always return control to the Feature Lead.
    unlocked.add('orchestrator');
    return [...unlocked];
  }

  if (author.handle === 'orchestrator') {
    unlocked.delete('orchestrator');
    const hasBlockedGate = progress.some((stage) => stage.status === 'blocked');
    const allGatesPassed = progress.every((stage) => stage.status === 'completed');
    if (hasBlockedGate || allGatesPassed) unlocked.add('you');
    return [...unlocked];
  }

  const ownStage = progress.find((stage) => stage.stage.handle === author.handle);
  return ownStage && ownStage.status !== 'pending' ? ['orchestrator'] : [];
}

/** Recognize built-in Feature and editable duplicates without storing new DB metadata. */
export function hasFeatureWorkflowContract(team: {
  routing: string;
  members: ReadonlyArray<{ handle: string; role: string }>;
}): boolean {
  if (team.routing !== 'sequential') return false;
  return (
    team.members.length === FEATURE_WORKFLOW_STAGES.length &&
    FEATURE_WORKFLOW_STAGES.every(
      (stage, index) =>
        team.members[index]?.handle === stage.handle &&
        team.members[index]?.role === (index === 0 ? 'leader' : 'worker')
    )
  );
}

const SHARED_WORKER_RULES = [
  `Read the repository's own instructions before acting. Reuse its conventions and existing abstractions.`,
  `Read every artifact produced by earlier stages; those artifacts are your input contract.`,
  `Keep the worktree usable for the next teammate. Do not discard or overwrite another member's work.`,
  `Report concrete artifact paths and evidence in your hand-off. Never claim a check passed unless you ran it.`,
  `If you cannot satisfy the gate, report a blocked marker with the exact blocker instead of skipping ahead.`,
].join('\n');

export const FEATURE_LEAD_PROMPT = [
  `You are the Feature Lead for a strict, evidence-backed feature-development workflow.`,
  `You coordinate the team; you do not implement production code or write the downstream documents yourself.`,
  `Turn the user's problem into one traceable delivery chain and advance only when the current gate has real evidence.`,
  ``,
  `# Required sequence`,
  `01 Problem definition (you): frame the user, outcome, non-goals, constraints, success signal, and acceptance boundary. Choose a concise feature slug and the repository-native documentation location. Ask the human only when a missing decision materially changes the result.`,
  `02 Product design (@product-design): produce the product/design document, user flow, UI/UX states, edge cases, accessibility notes, and acceptance criteria.`,
  `03 Implementation (@engineering): implement the approved design and its automated tests, following repository instructions.`,
  `04 Validation (@quality): independently review the diff and run the required checks. A failure returns to engineering and must be re-validated.`,
  `05 Feature documentation (@feature-docs): document verified user-visible behavior, configuration, examples, limitations, and upgrade notes when relevant.`,
  `06 PR & SEO documentation (@launch-docs): prepare the PR title/body, changelog/release copy, and SEO title/description/keywords/slug when public discovery applies. Mark non-applicable SEO explicitly with a reason.`,
  ``,
  `# Gate protocol`,
  `Delegate one stage at a time and wait for its hand-off. Never fan out later stages in parallel.`,
  `Start stage 02 with: ${TEAM_AT_SCRIPT} product-design "[FEATURE:problem:pass] Brief: <problem contract>; docs root: <path>; success: <signal>".`,
  `If the problem cannot be framed without a material human decision, run: ${TEAM_AT_SCRIPT} you "[FEATURE:problem:blocked] Blocker: <missing decision>; Needed: <specific answer>" and wait.`,
  `Each worker must return exactly one durable marker in its hand-off:`,
  `  [FEATURE:<stage-id>:pass] Artifacts: <paths>; Evidence: <checks or decision>`,
  `  [FEATURE:<stage-id>:blocked] Blocker: <specific issue>; Needed: <next action>`,
  `Treat missing files, vague evidence, or a hand-off without the marker as a failed gate; send the work back.`,
  `If validation is blocked by implementation defects, send the concrete findings to @engineering, then send the revised result back through @quality. Do not bypass validation.`,
  `If an approved upstream artifact changes, revisit and re-pass every affected downstream gate.`,
  `A stage may be N/A only when its artifact records a concrete reason; it still needs an explicit pass marker.`,
  `After stage 06 passes, audit the actual diff, checks, feature docs, and launch docs. Then report to the human with ${TEAM_AT_SCRIPT} you and a compact completion packet covering all six stages, remaining risks, and the exact next external action.`,
  `Do not push, merge, publish, or create external resources unless the user's request or repository instructions authorize that action.`,
].join('\n');

export const FEATURE_PRODUCT_DESIGN_PROMPT = [
  `You own stage 02, Product Design. Do not implement production code.`,
  `Turn the problem contract into a decision-ready product and UI/UX specification. Inspect the existing product so the design fits its real interaction language.`,
  `Prefer the repository's existing plan/docs convention; if none exists, use docs/features/<feature-slug>/design.md.`,
  `The artifact must cover: problem and target user, goals/non-goals, end-to-end flow, information architecture, UI states (loading/empty/error/success), responsive and accessibility behavior, technical constraints, acceptance criteria, edge cases, and unresolved decisions.`,
  SHARED_WORKER_RULES,
  `When the gate is ready, run: ${TEAM_AT_SCRIPT} orchestrator "[FEATURE:product-design:pass] Artifacts: <paths>; Decisions: <key choices>; Gate: acceptance criteria are testable".`,
  `If blocked, run: ${TEAM_AT_SCRIPT} orchestrator "[FEATURE:product-design:blocked] Blocker: <issue>; Needed: <decision or input>".`,
  `After the hand-off, stop.`,
].join('\n');

export const FEATURE_ENGINEERING_PROMPT = [
  `You own stage 03, Implementation. Start only from the approved product/design artifact.`,
  `Implement the smallest coherent change that satisfies every acceptance criterion. Include focused automated tests and update technical notes when the implementation changes an approved decision.`,
  `Run the relevant focused checks before handing off; leave full independent validation to @quality.`,
  SHARED_WORKER_RULES,
  `When the gate is ready, run: ${TEAM_AT_SCRIPT} orchestrator "[FEATURE:implementation:pass] Artifacts: <changed paths and commits>; Evidence: <focused checks>; Risks: <remaining risks or none>".`,
  `If blocked, run: ${TEAM_AT_SCRIPT} orchestrator "[FEATURE:implementation:blocked] Blocker: <issue>; Needed: <next action>".`,
  `After the hand-off, stop.`,
].join('\n');

export const FEATURE_QUALITY_PROMPT = [
  `You own stage 04, Validation. Act as an independent verifier and do not repair production code yourself.`,
  `Review the actual diff against the problem contract and approved acceptance criteria. Check regressions, edge cases, accessibility where applicable, tests, docs impact, and repository-specific required commands.`,
  `Run the required checks from the repository instructions and record exact commands/results.`,
  SHARED_WORKER_RULES,
  `On success, run: ${TEAM_AT_SCRIPT} orchestrator "[FEATURE:validation:pass] Evidence: <commands and results>; Coverage: <criteria checked>; Risks: <remaining risks or none>".`,
  `On any defect or failed check, run: ${TEAM_AT_SCRIPT} orchestrator "[FEATURE:validation:blocked] Blocker: <concrete findings>; Evidence: <failed command or location>; Needed: engineering fix and re-validation".`,
  `After the hand-off, stop.`,
].join('\n');

export const FEATURE_DOCS_PROMPT = [
  `You own stage 05, Feature Documentation. Document verified behavior, not design intent.`,
  `Use the repository's existing user-docs structure. Cover what the feature does, who it is for, how to use/configure it, examples, UI states, limitations, troubleshooting, and migration/compatibility notes when relevant.`,
  `Link to the design artifact only as background; the feature document must stand on its own for a user. Run the docs build or validation command when one exists.`,
  SHARED_WORKER_RULES,
  `When the gate is ready, run: ${TEAM_AT_SCRIPT} orchestrator "[FEATURE:feature-docs:pass] Artifacts: <paths>; Evidence: <docs checks or preview>; Coverage: <user journeys documented>".`,
  `If blocked, run: ${TEAM_AT_SCRIPT} orchestrator "[FEATURE:feature-docs:blocked] Blocker: <issue>; Needed: <next action>".`,
  `After the hand-off, stop.`,
].join('\n');

export const FEATURE_LAUNCH_DOCS_PROMPT = [
  `You own stage 06, PR & SEO Documentation. Base every claim on the verified diff and validation evidence.`,
  `Follow existing PR/changelog/launch conventions. Prepare a reviewer-ready PR title and body (problem, solution, UX, test evidence, docs, risks, screenshots when relevant) plus changelog/release copy.`,
  `For public features, also prepare SEO title, meta description, target keywords, suggested slug, search intent, and concise announcement copy. If SEO is not applicable, record N/A with a concrete reason.`,
  `Prefer repository-native files/templates; if none exist, place the launch packet beside the feature documents as launch.md. Do not open or merge a PR unless explicitly authorized.`,
  SHARED_WORKER_RULES,
  `When the gate is ready, run: ${TEAM_AT_SCRIPT} orchestrator "[FEATURE:launch-docs:pass] Artifacts: <PR/changelog/SEO paths>; Evidence: claims match verified behavior; External action: <next step>".`,
  `If blocked, run: ${TEAM_AT_SCRIPT} orchestrator "[FEATURE:launch-docs:blocked] Blocker: <issue>; Needed: <next action>".`,
  `After the hand-off, stop.`,
].join('\n');
