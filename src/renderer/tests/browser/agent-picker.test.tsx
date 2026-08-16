import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { Agent } from '@shared/agents';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  duplicate: vi.fn(),
  showModal: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) =>
      values?.count === undefined ? key : `${key}:${values.count}`,
  }),
}));

vi.mock('@renderer/features/skills/components/useSkills', () => ({
  useSkills: () => ({ installedSkills: [] }),
}));

vi.mock('@renderer/features/agents-config/use-agents', () => ({
  useAgents: () => ({ agents: [], duplicate: mocks.duplicate }),
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  useShowModal: () => mocks.showModal,
}));

vi.mock('@renderer/lib/layout/navigation-provider', () => ({
  useNavigate: () => ({ navigate: mocks.navigate }),
}));

vi.mock('@renderer/lib/ipc', () => ({ rpc: {}, events: {} }));

vi.mock('@renderer/lib/hooks/useTheme', () => ({
  useTheme: () => ({ effectiveTheme: 'ylight' }),
}));

describe('AgentPicker', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.querySelectorAll('[data-slot="popover-content"]').forEach((node) => node.remove());
    vi.clearAllMocks();
    host.remove();
  });

  it('shares one Base UI popover across a long agent list without button warnings', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const agents = Array.from({ length: 40 }, (_, index) => fixtureAgent(index));
    const { AgentPicker } = await import('@renderer/lib/components/agent-picker/agent-picker');

    await act(async () =>
      root.render(
        createElement(AgentPicker, {
          selectedAgent: agents[0]!,
          agents,
          onSelect: vi.fn(),
        })
      )
    );
    await act(async () => userEvent.click(host.querySelector('button')!));
    await settle();

    const listPopover = document.querySelector<HTMLElement>(
      '[data-slot="popover-content"][data-open]'
    );
    expect(listPopover).not.toBeNull();
    // One row is two buttons — pick and fork — plus create and manage in the header.
    expect(listPopover?.querySelectorAll('button')).toHaveLength(82);
    expect(document.querySelectorAll('[data-slot="popover-trigger"]')).toHaveLength(1);
    expect(consoleError.mock.calls.some((call) => String(call[0]).includes('Base UI'))).toBe(false);

    const secondRow = Array.from(listPopover!.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Agent 2')
    );
    await act(async () => userEvent.hover(secondRow!));
    await settle();

    expect(document.body.textContent).toContain('Prompt 2');
    expect(document.querySelectorAll('[data-slot="popover-trigger"]')).toHaveLength(1);
    consoleError.mockRestore();
  });

  it('forks a row into a copy and opens the editor on it', async () => {
    const agents = [fixtureAgent(0), fixtureAgent(1)];
    const copy = { ...agents[0]!, id: 'agent-0-copy', name: 'Agent 1 copy' };
    mocks.duplicate.mockResolvedValue(copy);
    const onSelect = vi.fn();
    const { AgentPicker } = await import('@renderer/lib/components/agent-picker/agent-picker');

    await act(async () =>
      root.render(createElement(AgentPicker, { selectedAgent: null, agents, onSelect }))
    );
    await act(async () => userEvent.click(host.querySelector('button')!));
    await settle();

    const listPopover = document.querySelector<HTMLElement>(
      '[data-slot="popover-content"][data-open]'
    );
    const forkButtons = listPopover!.querySelectorAll<HTMLButtonElement>(
      '[aria-label="agentManager.forkAgent"]'
    );
    expect(forkButtons).toHaveLength(2);

    await act(async () => userEvent.click(forkButtons[0]!));
    await settle();

    expect(mocks.duplicate).toHaveBeenCalledWith('agent-0');
    // The copy is only seated once the editor saves it — abandoning the editor
    // must not swap the caller's selection for a half-considered Agent.
    expect(onSelect).not.toHaveBeenCalled();
    expect(mocks.showModal).toHaveBeenCalledWith(
      expect.objectContaining({ agent: copy, onSuccess: expect.any(Function) })
    );

    const { onSuccess } = mocks.showModal.mock.calls[0]![0] as {
      onSuccess: (agent: Agent) => void;
    };
    onSuccess(copy);
    expect(onSelect).toHaveBeenCalledWith(copy);
  });
});

function fixtureAgent(index: number): Agent {
  return {
    id: `agent-${index}`,
    slug: `agent-${index}`,
    name: `Agent ${index + 1}`,
    description: `Description ${index + 1}`,
    icon: '',
    systemPrompt: `Prompt ${index + 1}`,
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

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}
