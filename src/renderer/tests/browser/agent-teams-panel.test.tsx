import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { Agent } from '@shared/agents';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  createTeam: vi.fn(),
  showAgentModal: vi.fn(),
  agents: [] as Agent[],
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) =>
      values?.count === undefined ? key : `${key}:${values.count}`,
  }),
}));

vi.mock('@renderer/features/agent-teams/use-agent-teams', () => ({
  useAgentTeams: () => ({
    teams: [],
    create: mocks.createTeam,
    update: vi.fn(),
    remove: vi.fn(),
    duplicate: vi.fn(),
  }),
}));

vi.mock('@renderer/features/agents-config/use-agents', () => ({
  useAgents: () => ({ agents: mocks.agents }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {},
  rpc: { agentTeams: { list: vi.fn().mockResolvedValue([]) } },
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  useShowModal: () => mocks.showAgentModal,
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@renderer/lib/components/avatar-input', () => ({
  AvatarInput: ({ id, appearance }: { id: string; appearance?: string }) => (
    <button id={id} type="button" data-appearance={appearance} />
  ),
}));

vi.mock('@renderer/lib/components/agent-card/agent-card', () => ({
  AgentCard: ({ name, trailing }: { name: string; trailing?: ReactNode }) => (
    <div>
      <span>{name}</span>
      {trailing}
    </div>
  ),
}));

vi.mock('@renderer/lib/components/agent-slot/agent-info-card', () => ({
  AgentInfoHover: ({ children }: { children: ReactNode }) => children,
}));

describe('AgentTeamsMainPanel', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.agents = [];
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.querySelectorAll('[data-slot="select-content"]').forEach((node) => node.remove());
    host.remove();
  });

  it('uses the shared profile layout and adds a newly created agent to the team draft', async () => {
    const { AgentTeamsMainPanel } = await import(
      '@renderer/features/agent-teams/agent-teams-panel'
    );
    await act(async () => root.render(createElement(AgentTeamsMainPanel)));

    await clickUser(host.querySelector('[aria-label="agentTeams.newTeam"]')!);

    expect(host.querySelector('#agent-team-avatar')?.getAttribute('data-appearance')).toBe(
      'profile'
    );
    expect(host.querySelector<HTMLInputElement>('#agent-team-name')?.required).toBe(true);
    expect(host.querySelectorAll('[data-slot="select-trigger"]')).toHaveLength(3);

    const createAgentButton = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === 'agentTeams.createAgent'
    );
    await clickUser(createAgentButton!);

    expect(mocks.showAgentModal).toHaveBeenCalledTimes(1);
    const [{ onSuccess }] = mocks.showAgentModal.mock.calls[0] as [
      { onSuccess: (agent: Agent) => void },
    ];
    await act(async () => onSuccess(fixtureAgent()));

    expect(host.textContent).toContain('New teammate');
    const saveButton = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === 'agentTeams.saveTeam'
    );
    expect(saveButton?.disabled).toBe(true);

    await act(async () => {
      await userEvent.fill(host.querySelector<HTMLInputElement>('#agent-team-name')!, 'Review');
    });
    expect(saveButton?.disabled).toBe(false);
  });

  it('keeps the member picker scrollable and reusable after closing', async () => {
    mocks.agents = Array.from({ length: 18 }, (_, index) => ({
      ...fixtureAgent(),
      id: `agent-${index}`,
      slug: `agent-${index}`,
      name: `Agent ${index + 1}`,
    }));
    const { AgentTeamsMainPanel } = await import(
      '@renderer/features/agent-teams/agent-teams-panel'
    );
    await act(async () => root.render(createElement(AgentTeamsMainPanel)));
    await clickUser(host.querySelector('[aria-label="agentTeams.newTeam"]')!);

    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="agentTeams.addAgent"]');
    expect(trigger?.disabled).toBe(false);
    await clickUser(trigger!);
    await settle();

    const firstPopup = document.querySelector<HTMLElement>(
      '[data-slot="select-content"][data-open]'
    );
    expect(firstPopup).not.toBeNull();
    expect(firstPopup?.style.maxHeight).toBe('16rem');
    const firstList = firstPopup!.querySelector<HTMLElement>('[role="listbox"]');
    expect(firstList).not.toBeNull();
    expect(getComputedStyle(firstList!).overflowY).toBe('auto');
    expect(firstList!.scrollHeight).toBeGreaterThan(firstList!.clientHeight);
    firstList!.scrollTop = 80;
    firstList!.dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(firstList!.scrollTop).toBeGreaterThan(0);

    await act(async () => userEvent.keyboard('{Escape}'));
    await settle();
    await clickUser(trigger!);
    await settle();

    expect(document.querySelector('[data-slot="select-content"][data-open]')).not.toBeNull();
  });
});

function fixtureAgent(): Agent {
  return {
    id: 'agent-new',
    slug: 'new-teammate',
    name: 'New teammate',
    description: '',
    icon: '',
    systemPrompt: '',
    enabledSkillIds: [],
    manualSkillIds: [],
    skillPolicyMode: 'runtime-defaults',
    preferredRuntime: 'codex',
    model: null,
    reasoningEffort: null,
    accessMode: 'inherit',
    source: 'local',
    createdAt: '',
    updatedAt: '',
  };
}

async function clickUser(element: Element): Promise<void> {
  await act(async () => userEvent.click(element));
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}
