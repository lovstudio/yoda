import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Feature, FeatureStageId } from '@shared/features';
import { DEFAULT_TEAM_COMMUNICATION_CONFIG } from '@shared/team-communication';
import type { RoomMember, RoomMessage, TeamRoom } from '@shared/team-room';

const mocks = vi.hoisted(() => ({
  proposeArtifacts: vi.fn(),
  recordHandoff: vi.fn(),
  updateTaskStatusForActiveFeatureHandoff: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('./feature-service', () => ({
  featureService: {
    proposeArtifacts: mocks.proposeArtifacts,
    recordHandoff: mocks.recordHandoff,
  },
}));

vi.mock('@main/core/tasks/operations/updateTaskStatus', () => ({
  updateTaskStatusForActiveFeatureHandoff: mocks.updateTaskStatusForActiveFeatureHandoff,
}));

vi.mock('@main/lib/events', () => ({ events: { emit: mocks.emit } }));

const room: TeamRoom = {
  id: 'room-1',
  projectId: 'project-1',
  taskId: 'task-1',
  featureId: 'feature-1',
  name: 'Feature',
  preset: 'feature-workflow',
  status: 'active',
  routingHopLimit: 100,
  communication: DEFAULT_TEAM_COMMUNICATION_CONFIG,
  createdAt: '2026-07-13T00:00:00.000Z',
  updatedAt: '2026-07-13T00:00:00.000Z',
};

function member(handle: string): RoomMember {
  return {
    id: `member-${handle}`,
    roomId: room.id,
    conversationId: `conversation-${handle}`,
    handle,
    displayName: handle,
    icon: '',
    role: handle === 'orchestrator' ? 'leader' : 'worker',
    runtime: 'codex',
    systemPrompt: '',
    skillSelection: null,
    autoApprove: false,
    accent: 'slate',
    status: 'finished',
    createdAt: room.createdAt,
  };
}

const members = [member('orchestrator'), member('product-design'), member('engineering')];

function feature(
  stage: FeatureStageId,
  taskStatus: Feature['tasks'][number]['status'] = 'in_progress'
): Feature {
  return {
    id: 'feature-1',
    projectId: 'project-1',
    title: 'Feature',
    problem: 'One source of truth is required.',
    outcome: '',
    nonGoals: '',
    stage,
    status: 'active',
    templateId: 'feature-development-v1',
    sourceIssues: [],
    tasks: [
      {
        taskId: 'task-1',
        name: 'Task',
        status: taskStatus,
        archivedAt: null,
        workflowRoomId: room.id,
      },
    ],
    artifacts: [],
    events: [],
    gate: { stage, nextStage: null, canAdvance: false, blockers: [] },
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    completedAt: null,
  };
}

function handoff(body: string, author: string): RoomMessage {
  return {
    id: 'message-1',
    roomId: room.id,
    authorMemberId: `member-${author}`,
    kind: 'handoff',
    body,
    mentions: ['orchestrator'],
    sessionRef: `conversation-${author}`,
    verdict: null,
    createdAt: '2026-07-13T00:00:01.000Z',
  };
}

describe('Feature loop hand-off ingestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateTaskStatusForActiveFeatureHandoff.mockResolvedValue(true);
  });

  it('proposes complete current-stage evidence as drafts through FeatureService', async () => {
    const { ingestFeatureWorkflowHandoff } = await import('./feature-loop-service');
    const message = handoff(
      '[FEATURE:product-design:ready] {"summary":"reviewable","evidence":"criteria checked","artifacts":[{"type":"product_spec","title":"Spec","uri":"docs/design.md"},{"type":"ux_design","title":"UX","uri":"docs/design.md"},{"type":"acceptance_criteria","title":"AC","uri":"docs/design.md"}]}',
      'product-design'
    );

    await expect(
      ingestFeatureWorkflowHandoff({ room, feature: feature('design'), members, message })
    ).resolves.toBe(true);
    expect(mocks.proposeArtifacts).toHaveBeenCalledWith(
      'project-1',
      'feature-1',
      expect.arrayContaining([
        expect.objectContaining({ type: 'product_spec' }),
        expect.objectContaining({ type: 'ux_design' }),
        expect.objectContaining({ type: 'acceptance_criteria' }),
      ]),
      expect.objectContaining({
        taskId: 'task-1',
        roomId: 'room-1',
        messageId: 'message-1',
        stage: 'design',
        verdict: 'ready',
      })
    );
  });

  it('rejects incomplete or out-of-scope artifact proposals', async () => {
    const { ingestFeatureWorkflowHandoff } = await import('./feature-loop-service');
    const message = handoff(
      '[FEATURE:product-design:ready] {"summary":"incomplete","evidence":"none","artifacts":[{"type":"product_spec","title":"Spec","uri":"../outside.md"}]}',
      'product-design'
    );

    await expect(
      ingestFeatureWorkflowHandoff({ room, feature: feature('design'), members, message })
    ).rejects.toThrow();
    expect(mocks.proposeArtifacts).not.toHaveBeenCalled();
  });

  it('moves implementation-ready Task to review without approving the Feature gate', async () => {
    const { ingestFeatureWorkflowHandoff } = await import('./feature-loop-service');
    const message = handoff(
      '[FEATURE:implementation:ready] {"summary":"ready for review","evidence":"focused tests passed","artifacts":[]}',
      'engineering'
    );

    await ingestFeatureWorkflowHandoff({
      room,
      feature: feature('implementation'),
      members,
      message,
    });

    expect(mocks.recordHandoff).toHaveBeenCalledOnce();
    expect(mocks.updateTaskStatusForActiveFeatureHandoff).toHaveBeenCalledWith({
      projectId: 'project-1',
      featureId: 'feature-1',
      featureStage: 'implementation',
      taskId: 'task-1',
      status: 'review',
    });
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ taskId: 'task-1', status: 'review' })
    );
    expect(mocks.proposeArtifacts).not.toHaveBeenCalled();
  });

  it('records blockers as evidence without changing aggregate status', async () => {
    const { ingestFeatureWorkflowHandoff } = await import('./feature-loop-service');
    const message = handoff(
      '[FEATURE:implementation:blocked] {"blocker":"dependency unavailable","needed":"human decision"}',
      'engineering'
    );

    await ingestFeatureWorkflowHandoff({ room, feature: feature('planning'), members, message });

    expect(mocks.recordHandoff).toHaveBeenCalledWith(
      'project-1',
      'feature-1',
      expect.objectContaining({ verdict: 'blocked', stage: 'planning' })
    );
    expect(mocks.updateTaskStatusForActiveFeatureHandoff).not.toHaveBeenCalled();
  });

  it.each(['blocked', 'cancelled', 'completed'] as const)(
    'rejects in-flight evidence after the Feature becomes %s',
    async (status) => {
      const { ingestFeatureWorkflowHandoff } = await import('./feature-loop-service');
      const current = feature('implementation');
      current.status = status;
      const message = handoff(
        '[FEATURE:implementation:ready] {"summary":"late","evidence":"stale reply","artifacts":[]}',
        'engineering'
      );

      await expect(
        ingestFeatureWorkflowHandoff({ room, feature: current, members, message })
      ).resolves.toBe(false);
      expect(mocks.recordHandoff).not.toHaveBeenCalled();
      expect(mocks.proposeArtifacts).not.toHaveBeenCalled();
      expect(mocks.updateTaskStatusForActiveFeatureHandoff).not.toHaveBeenCalled();
      expect(mocks.emit).not.toHaveBeenCalled();
    }
  );
});
