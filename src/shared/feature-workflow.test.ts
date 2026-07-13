import { describe, expect, it } from 'vitest';
import {
  deriveFeatureWorkflowProgress,
  FEATURE_WORKFLOW_STAGES,
  featureWorkflowAllowedTargetHandles,
  parseFeatureWorkflowStageSignal,
} from './feature-workflow';
import type { RoomMember, RoomMessage } from './team-room';

function handoff(
  body: string,
  index: number,
  authorHandle: string,
  mention = 'orchestrator'
): RoomMessage {
  return {
    id: `message-${index}`,
    roomId: 'room-1',
    authorMemberId: `member-${authorHandle}`,
    kind: 'handoff',
    body,
    mentions: [mention],
    sessionRef: `conversation-${index}`,
    verdict: null,
    createdAt: new Date(2026, 6, 13, 0, 0, index).toISOString(),
  };
}

function member(handle: string, status: RoomMember['status']): RoomMember {
  return {
    id: `member-${handle}`,
    roomId: 'room-1',
    conversationId: `conversation-${handle}`,
    handle,
    displayName: handle,
    icon: '',
    role: handle === 'you' ? 'lead' : handle === 'orchestrator' ? 'leader' : 'worker',
    runtime: handle === 'you' ? null : 'codex',
    systemPrompt: '',
    skillSelection: null,
    autoApprove: false,
    accent: 'slate',
    status,
    createdAt: '2026-07-13T00:00:00.000Z',
  };
}

const workflowMembers = FEATURE_WORKFLOW_STAGES.map((stage) => member(stage.handle, 'finished'));
const roomMembers = [member('you', 'idle'), ...workflowMembers];

const SIGNALS = {
  problem: '[FEATURE:problem:pass] Brief: search flow; success: users find a result',
  product:
    '[FEATURE:product-design:pass] Artifacts: docs/design.md; Decisions: inline search; Gate: criteria are testable',
  implementation:
    '[FEATURE:implementation:pass] Artifacts: src/search.ts; Evidence: focused tests pass; Risks: none',
  validation:
    '[FEATURE:validation:pass] Evidence: pnpm test; Coverage: acceptance criteria; Risks: none',
  featureDocs:
    '[FEATURE:feature-docs:pass] Artifacts: docs/search.mdx; Evidence: docs build; Coverage: user journey',
  launchDocs:
    '[FEATURE:launch-docs:pass] Artifacts: docs/launch.md; Evidence: claims checked; External action: open PR',
} as const;

describe('feature workflow protocol', () => {
  it('parses a gate marker while preserving its human-readable evidence', () => {
    expect(
      parseFeatureWorkflowStageSignal(
        '[FEATURE:validation:pass] Evidence: pnpm test; Coverage: acceptance criteria; Risks: none'
      )
    ).toEqual({
      stageId: 'validation',
      verdict: 'pass',
      detail: 'Evidence: pnpm test; Coverage: acceptance criteria; Risks: none',
    });
    expect(parseFeatureWorkflowStageSignal('[FEATURE:unknown:pass] nope')).toBeNull();
    expect(parseFeatureWorkflowStageSignal('validation passed')).toBeNull();
    expect(parseFeatureWorkflowStageSignal('[FEATURE:validation:pass]')).toBeNull();
    expect(
      parseFeatureWorkflowStageSignal(
        'Do not emit [FEATURE:validation:pass] until the checks actually pass.'
      )
    ).toBeNull();
    expect(
      parseFeatureWorkflowStageSignal(
        '[FEATURE:validation:pass] Evidence: tests passed; Coverage: all; Risks: none [FEATURE:launch-docs:pass] not really'
      )
    ).toBeNull();
    expect(
      parseFeatureWorkflowStageSignal(
        '[FEATURE:validation:pass] Evidence: tests passed; Risks: none'
      )
    ).toBeNull();
  });

  it('advances only through ordered durable hand-offs', () => {
    const progress = deriveFeatureWorkflowProgress(workflowMembers, [
      handoff(SIGNALS.problem, 1, 'orchestrator', 'product-design'),
      handoff(SIGNALS.product, 2, 'product-design'),
      handoff(SIGNALS.implementation, 3, 'engineering'),
    ]);

    expect(progress.map((stage) => stage.status)).toEqual([
      'completed',
      'completed',
      'completed',
      'active',
      'pending',
      'pending',
    ]);
    expect(progress[1]?.detail).toContain('Artifacts: docs/design.md');
  });

  it('does not let an out-of-order result skip a missing gate', () => {
    const progress = deriveFeatureWorkflowProgress(workflowMembers, [
      handoff(SIGNALS.problem, 1, 'orchestrator', 'product-design'),
      handoff(SIGNALS.implementation, 2, 'engineering'),
    ]);

    expect(progress.map((stage) => stage.status)).toEqual([
      'completed',
      'active',
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
  });

  it('invalidates downstream gates when an earlier stage is re-passed', () => {
    const progress = deriveFeatureWorkflowProgress(workflowMembers, [
      handoff(SIGNALS.problem, 1, 'orchestrator', 'product-design'),
      handoff(SIGNALS.product, 2, 'product-design'),
      handoff(SIGNALS.implementation, 3, 'engineering'),
      handoff(
        '[FEATURE:validation:blocked] Blocker: accessibility regression; Needed: engineering fix',
        4,
        'quality'
      ),
      handoff(
        '[FEATURE:implementation:pass] Artifacts: src/search.ts; Evidence: regression test passes; Risks: none',
        5,
        'engineering'
      ),
    ]);

    expect(progress.map((stage) => stage.status)).toEqual([
      'completed',
      'completed',
      'completed',
      'active',
      'pending',
      'pending',
    ]);
    expect(progress[3]?.detail).toBe('');
  });

  it('uses live state for the current stage without treating finished as a gate', () => {
    const progress = deriveFeatureWorkflowProgress(
      [member('orchestrator', 'finished'), member('product-design', 'awaiting-input')],
      [handoff(SIGNALS.problem, 1, 'orchestrator', 'product-design')]
    );

    expect(progress[0]?.status).toBe('completed');
    expect(progress[1]?.status).toBe('blocked');
  });

  it('rejects a gate marker from the wrong role or outside the hand-off path', () => {
    const progress = deriveFeatureWorkflowProgress(workflowMembers, [
      handoff(SIGNALS.problem, 1, 'engineering', 'product-design'),
      handoff(SIGNALS.problem, 2, 'orchestrator', 'you'),
    ]);

    expect(progress[0]?.status).toBe('active');
    expect(progress.slice(1).every((stage) => stage.status === 'pending')).toBe(true);
  });

  it('lets the Feature Lead persist a problem blocker to the human lead', () => {
    const progress = deriveFeatureWorkflowProgress(workflowMembers, [
      handoff(
        '[FEATURE:problem:blocked] Blocker: target user is ambiguous; Needed: choose the target user',
        1,
        'orchestrator',
        'you'
      ),
    ]);

    expect(progress[0]?.status).toBe('blocked');
    expect(progress[0]?.detail).toContain('Needed: choose the target user');
  });

  it('allows only the current gate to start and blocks fan-out', () => {
    const opening = handoff('Build search', 0, 'you', 'orchestrator');
    opening.kind = 'text';
    expect(featureWorkflowAllowedTargetHandles(roomMembers, [opening], opening)).toEqual([
      'orchestrator',
    ]);

    const skipped = handoff('Start coding now', 1, 'orchestrator', 'engineering');
    expect(
      featureWorkflowAllowedTargetHandles(roomMembers, [opening, skipped], skipped)
    ).not.toContain('engineering');

    const passed = handoff(SIGNALS.problem, 2, 'orchestrator', 'product-design');
    expect(featureWorkflowAllowedTargetHandles(roomMembers, [opening, passed], passed)).toContain(
      'product-design'
    );

    const broadcast = handoff('Start every stage', 3, 'orchestrator', 'all');
    expect(
      featureWorkflowAllowedTargetHandles(roomMembers, [opening, passed, broadcast], broadcast)
    ).toEqual([]);

    const multiTarget = handoff('Run both stages', 4, 'orchestrator', 'product-design');
    multiTarget.mentions.push('engineering');
    expect(
      featureWorkflowAllowedTargetHandles(roomMembers, [opening, passed, multiTarget], multiTarget)
    ).toEqual([]);
  });

  it('allows human escalation only through the Feature Lead', () => {
    const runningLeadMembers = roomMembers.map((roomMember) =>
      roomMember.handle === 'orchestrator'
        ? { ...roomMember, status: 'running' as const }
        : roomMember
    );
    const blocker = handoff(
      '[FEATURE:problem:blocked] Blocker: target user is ambiguous; Needed: human decision',
      1,
      'orchestrator',
      'you'
    );
    expect(featureWorkflowAllowedTargetHandles(runningLeadMembers, [blocker], blocker)).toContain(
      'you'
    );

    const workerEscalation = handoff('I need a decision', 2, 'product-design', 'you');
    expect(
      featureWorkflowAllowedTargetHandles(
        roomMembers,
        [handoff(SIGNALS.problem, 1, 'orchestrator', 'product-design'), workerEscalation],
        workerEscalation
      )
    ).toEqual(['orchestrator']);
  });

  it('lets the running Feature Lead return the completion packet to the human', () => {
    const history = [
      handoff(SIGNALS.problem, 1, 'orchestrator', 'product-design'),
      handoff(SIGNALS.product, 2, 'product-design'),
      handoff(SIGNALS.implementation, 3, 'engineering'),
      handoff(SIGNALS.validation, 4, 'quality'),
      handoff(SIGNALS.featureDocs, 5, 'feature-docs'),
      handoff(SIGNALS.launchDocs, 6, 'launch-docs'),
    ];
    const completion = handoff('All six gates passed with evidence.', 7, 'orchestrator', 'you');
    const runningMembers = roomMembers.map((roomMember) =>
      roomMember.handle === 'orchestrator' || roomMember.handle === 'launch-docs'
        ? { ...roomMember, status: 'running' as const }
        : roomMember
    );

    expect(
      featureWorkflowAllowedTargetHandles(runningMembers, [...history, completion], completion)
    ).toContain('you');
  });

  it('unlocks implementation repair after validation blocks without unlocking documentation', () => {
    const history = [
      handoff(SIGNALS.problem, 1, 'orchestrator', 'product-design'),
      handoff(SIGNALS.product, 2, 'product-design'),
      handoff(SIGNALS.implementation, 3, 'engineering'),
      handoff(
        '[FEATURE:validation:blocked] Blocker: regression; Needed: engineering fix and re-validation',
        4,
        'quality'
      ),
    ];
    const repair = handoff('Repair the regression', 5, 'orchestrator', 'engineering');
    const allowed = featureWorkflowAllowedTargetHandles(roomMembers, [...history, repair], repair);

    expect(allowed).toContain('engineering');
    expect(allowed).not.toContain('feature-docs');
    expect(allowed).not.toContain('launch-docs');
  });

  it('completes all six gates only with ordered structured evidence', () => {
    const progress = deriveFeatureWorkflowProgress(workflowMembers, [
      handoff(SIGNALS.problem, 1, 'orchestrator', 'product-design'),
      handoff(SIGNALS.product, 2, 'product-design'),
      handoff(SIGNALS.implementation, 3, 'engineering'),
      handoff(SIGNALS.validation, 4, 'quality'),
      handoff(SIGNALS.featureDocs, 5, 'feature-docs'),
      handoff(SIGNALS.launchDocs, 6, 'launch-docs'),
    ]);

    expect(progress.every((stage) => stage.status === 'completed')).toBe(true);
  });

  it('keeps the six-stage contract stable', () => {
    expect(FEATURE_WORKFLOW_STAGES.map((stage) => stage.id)).toEqual([
      'problem',
      'product-design',
      'implementation',
      'validation',
      'feature-docs',
      'launch-docs',
    ]);
    expect(new Set(FEATURE_WORKFLOW_STAGES.map((stage) => stage.handle)).size).toBe(6);
  });
});
