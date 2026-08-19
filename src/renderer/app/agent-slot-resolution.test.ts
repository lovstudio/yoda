import { describe, expect, it } from 'vitest';
import type { Agent } from '@shared/agents';
import { resolveAgentSlot } from './agent-slot-resolution';

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    slug: 'agent-1',
    name: 'Agent One',
    description: '',
    icon: '🤖',
    systemPrompt: 'Use the configured Agent profile.',
    enabledSkillIds: [],
    manualSkillIds: [],
    skillPolicyMode: 'runtime-defaults',
    preferredRuntime: 'codex',
    model: null,
    modelSuffix: null,
    reasoningEffort: null,
    accessMode: 'inherit',
    source: 'local',
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
    ...overrides,
  };
}

describe('resolveAgentSlot', () => {
  it('uses the selected Agent runtime ahead of the run-mode fallback', () => {
    const agent = makeAgent({ preferredRuntime: 'codex' });

    expect(
      resolveAgentSlot({
        selectedAgentId: agent.id,
        agents: [agent],
        fallbackRuntime: 'claude',
      })
    ).toMatchObject({
      agent,
      provider: 'codex',
      systemPrompt: agent.systemPrompt,
    });
  });

  it('uses the run-mode fallback only when the Agent intentionally has no runtime', () => {
    const agent = makeAgent({ preferredRuntime: null });

    expect(
      resolveAgentSlot({
        selectedAgentId: agent.id,
        agents: [agent],
        fallbackRuntime: 'claude',
      }).provider
    ).toBe('claude');
  });

  it('does not resolve a runtime without an assigned Agent', () => {
    expect(
      resolveAgentSlot({
        selectedAgentId: 'missing-agent',
        agents: [makeAgent()],
        fallbackRuntime: 'claude',
      })
    ).toEqual({ provider: null, systemPrompt: '', agent: null });
  });
});
