import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_FEATURE_TEAM_ID, BUILTIN_TEAMS } from '@shared/agent-team';
import type { Feature } from '@shared/features';
import { DEFAULT_TEAM_COMMUNICATION_CONFIG } from '@shared/team-communication';
import type { RoomMember, RoomSnapshot, TeamRoom } from '@shared/team-room';

const mocks = vi.hoisted(() => ({
  getTeam: vi.fn(),
  getAgent: vi.fn(),
  getAgentBySlug: vi.fn(),
  ensureForTask: vi.fn(),
  getFeature: vi.fn(),
  createRoom: vi.fn(),
  addMember: vi.fn(),
  postMessage: vi.fn(),
  getFeatureRoomForTask: vi.fn(),
  archiveRoom: vi.fn(),
}));

vi.mock('@main/core/agent-teams/agent-teams-service', () => ({
  agentTeamsService: { get: mocks.getTeam },
}));

vi.mock('@main/core/features/feature-service', () => ({
  featureService: { ensureForTask: mocks.ensureForTask, get: mocks.getFeature },
}));

vi.mock('@main/core/agents-config/agents-config-service', () => ({
  agentsConfigService: { get: mocks.getAgent, getBySlug: mocks.getAgentBySlug },
}));

vi.mock('./store', () => ({
  createRoom: mocks.createRoom,
  addMember: mocks.addMember,
  postMessage: mocks.postMessage,
  getFeatureRoomForTask: mocks.getFeatureRoomForTask,
  archiveRoom: mocks.archiveRoom,
}));

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

const feature: Feature = {
  id: 'feature-1',
  projectId: 'project-1',
  title: 'Feature',
  problem: 'One source of truth.',
  outcome: '',
  nonGoals: '',
  stage: 'problem',
  status: 'active',
  templateId: 'feature-development-v1',
  sourceIssues: [],
  tasks: [
    {
      taskId: 'task-1',
      name: 'Task',
      status: 'in_progress',
      archivedAt: null,
      workflowRoomId: room.id,
    },
  ],
  artifacts: [],
  events: [],
  gate: { stage: 'problem', nextStage: 'design', canAdvance: true, blockers: [] },
  createdAt: room.createdAt,
  updatedAt: room.updatedAt,
  completedAt: null,
};

describe('Feature Team Room creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const team = BUILTIN_TEAMS.find((candidate) => candidate.id === BUILTIN_FEATURE_TEAM_ID);
    mocks.getTeam.mockResolvedValue(team);
    mocks.ensureForTask.mockResolvedValue(feature);
    mocks.getFeature.mockResolvedValue(feature);
    mocks.getFeatureRoomForTask.mockResolvedValue(null);
    mocks.getAgent.mockResolvedValue(null);
    mocks.getAgentBySlug.mockResolvedValue(null);
    mocks.createRoom.mockResolvedValue(room);
    let memberIndex = 0;
    mocks.addMember.mockImplementation(async (input) => {
      memberIndex += 1;
      return {
        id: `member-${memberIndex}`,
        roomId: room.id,
        conversationId: null,
        handle: input.handle,
        displayName: input.displayName,
        icon: input.icon ?? '',
        role: input.role,
        runtime: input.runtime ?? null,
        systemPrompt: input.systemPrompt ?? '',
        skillSelection: input.skillSelection ?? null,
        autoApprove: false,
        accent: input.accent ?? 'slate',
        status: 'idle',
        createdAt: room.createdAt,
      } satisfies RoomMember;
    });
  });

  it('creates one linked authoritative Feature before seeding the Room', async () => {
    const { createRoomFromTeam } = await import('./presets');
    const roomId = await createRoomFromTeam({
      projectId: 'project-1',
      taskId: 'task-1',
      teamId: BUILTIN_FEATURE_TEAM_ID,
      requirement: 'Deliver one governed Feature.',
    });

    expect(roomId).toBe(room.id);
    expect(mocks.ensureForTask).toHaveBeenCalledWith(
      'project-1',
      'task-1',
      'Deliver one governed Feature.',
      'agent'
    );
    expect(mocks.createRoom).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        taskId: 'task-1',
        featureId: feature.id,
        preset: 'feature-workflow',
      })
    );
    expect(mocks.addMember).toHaveBeenCalledTimes(7);
    expect(mocks.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining(`Authoritative Feature: ${feature.id}`),
      })
    );
  });

  it('captures each referenced Agent execution profile in the room member', async () => {
    mocks.getTeam.mockResolvedValue({
      id: 'team-planner-implementer',
      name: 'Planner + Implementer',
      icon: '👥',
      routing: 'sequential',
      communication: { ...DEFAULT_TEAM_COMMUNICATION_CONFIG, mode: 'process', syncToRoom: false },
      builtin: false,
      routingHopLimit: 100,
      members: [
        {
          handle: 'planner-agent',
          displayName: 'Planner',
          role: 'leader',
          runtime: 'codex',
          agentRef: 'planner-id',
        },
        {
          handle: 'implementer-agent',
          displayName: 'Implementer',
          role: 'worker',
          runtime: 'codex',
          agentRef: 'implementer-id',
        },
      ],
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
    });
    mocks.getAgent.mockImplementation(async (id: string) => ({
      id,
      slug: id,
      name: id,
      description: '',
      icon: '🤖',
      systemPrompt: '',
      enabledSkillIds: [],
      manualSkillIds: [],
      skillPolicyMode: 'runtime-defaults',
      preferredRuntime: 'codex',
      model: id === 'planner-id' ? 'gpt-5.6-sol' : 'gpt-5.6-luna',
      reasoningEffort: id === 'planner-id' ? 'high' : 'medium',
      accessMode: 'write',
      source: 'local',
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
    }));

    const { createRoomFromTeam } = await import('./presets');
    await createRoomFromTeam({
      projectId: 'project-1',
      taskId: 'task-1',
      teamId: 'team-planner-implementer',
      requirement: 'Plan, then implement.',
    });

    expect(mocks.addMember).toHaveBeenCalledWith(
      expect.objectContaining({
        handle: 'planner-agent',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high',
        permissionMode: 'full-auto',
      })
    );
    expect(mocks.addMember).toHaveBeenCalledWith(
      expect.objectContaining({
        handle: 'implementer-agent',
        model: 'gpt-5.6-luna',
        reasoningEffort: 'medium',
        permissionMode: 'full-auto',
      })
    );
  });

  it('reuses a complete active Room for retries', async () => {
    const team = BUILTIN_TEAMS.find((candidate) => candidate.id === BUILTIN_FEATURE_TEAM_ID);
    const handles = ['you', ...(team?.members.map((member) => member.handle) ?? [])];
    const existing = {
      room,
      members: handles.map((handle, index) => ({
        id: `existing-${index}`,
        roomId: room.id,
        conversationId: null,
        handle,
        displayName: handle,
        icon: '',
        role: handle === 'you' ? 'lead' : 'worker',
        runtime: handle === 'you' ? null : 'codex',
        systemPrompt: '',
        skillSelection: null,
        autoApprove: false,
        accent: 'slate',
        status: 'idle',
        createdAt: room.createdAt,
      })),
      messages: [],
    } satisfies RoomSnapshot;
    mocks.getFeatureRoomForTask.mockResolvedValue(existing);
    const { createRoomFromTeam } = await import('./presets');

    await expect(
      createRoomFromTeam({
        projectId: 'project-1',
        taskId: 'task-1',
        teamId: BUILTIN_FEATURE_TEAM_ID,
        requirement: 'Retry.',
      })
    ).resolves.toBe(room.id);
    expect(mocks.createRoom).not.toHaveBeenCalled();
    expect(mocks.archiveRoom).not.toHaveBeenCalled();
  });

  it('coalesces concurrent starts so the Room is seeded once', async () => {
    const { createRoomFromTeam } = await import('./presets');
    const input = {
      projectId: 'project-1',
      taskId: 'task-1',
      teamId: BUILTIN_FEATURE_TEAM_ID,
      requirement: 'Concurrent double click.',
    };

    await expect(
      Promise.all([createRoomFromTeam(input), createRoomFromTeam(input)])
    ).resolves.toEqual([room.id, room.id]);
    expect(mocks.ensureForTask).toHaveBeenCalledTimes(1);
    expect(mocks.createRoom).toHaveBeenCalledTimes(1);
    expect(mocks.addMember).toHaveBeenCalledTimes(7);
  });
});
