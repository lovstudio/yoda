import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TEAM_COMMUNICATION_CONFIG } from '@shared/team-communication';
import type { RoomMember, TeamRoom } from '@shared/team-room';

const mocks = vi.hoisted(() => ({
  getTeam: vi.fn(),
  getAgent: vi.fn(),
  getAgentBySlug: vi.fn(),
  createRoom: vi.fn(),
  addMember: vi.fn(),
  postMessage: vi.fn(),
}));

vi.mock('@main/core/agent-teams/agent-teams-service', () => ({
  agentTeamsService: { get: mocks.getTeam },
}));

vi.mock('@main/core/agents-config/agents-config-service', () => ({
  agentsConfigService: { get: mocks.getAgent, getBySlug: mocks.getAgentBySlug },
}));

vi.mock('./store', () => ({
  createRoom: mocks.createRoom,
  addMember: mocks.addMember,
  postMessage: mocks.postMessage,
}));

const room: TeamRoom = {
  id: 'room-1',
  projectId: 'project-1',
  taskId: 'task-1',
  name: 'Planner + Implementer',
  preset: 'freeform',
  status: 'active',
  routingHopLimit: 100,
  communication: DEFAULT_TEAM_COMMUNICATION_CONFIG,
  createdAt: '2026-07-13T00:00:00.000Z',
  updatedAt: '2026-07-13T00:00:00.000Z',
};

describe('Team Room creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('captures each referenced Agent execution profile in the room member', async () => {
    mocks.getTeam.mockResolvedValue({
      id: 'team-planner-implementer',
      name: 'Planner + Implementer',
      icon: '👥',
      routing: 'sequential',
      communication: { ...DEFAULT_TEAM_COMMUNICATION_CONFIG, mode: 'process', syncToRoom: false },
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
    const planner = mocks.addMember.mock.calls.find(
      ([input]) => input.handle === 'planner-agent'
    )?.[0];
    const implementer = mocks.addMember.mock.calls.find(
      ([input]) => input.handle === 'implementer-agent'
    )?.[0];
    expect(planner?.systemPrompt).toContain(
      'First complete the responsibility defined by your own Agent profile yourself.'
    );
    expect(planner?.systemPrompt).toContain('Only after your own result is ready');
    expect(planner?.systemPrompt).not.toContain('you do NOT do it yourself');
    expect(implementer?.systemPrompt).toContain("Do not redo the previous stage's work.");
    expect(implementer?.systemPrompt).toContain('instead of taking over its role');
  });
});
