import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { Agent } from '@shared/agents';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) =>
      values?.count === undefined ? key : `${key}:${values.count}`,
  }),
}));

vi.mock('@renderer/features/skills/components/useSkills', () => ({
  useSkills: () => ({ installedSkills: [] }),
}));

vi.mock('@renderer/lib/ipc', () => ({ rpc: {}, events: {} }));

vi.mock('@renderer/lib/hooks/useTheme', () => ({
  useTheme: () => ({ effectiveTheme: 'ylight' }),
}));

describe('AgentSlotSelector', () => {
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
    vi.restoreAllMocks();
    host.remove();
  });

  it('shares one Base UI popover across a long agent list without button warnings', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const agents = Array.from({ length: 40 }, (_, index) => fixtureAgent(index));
    const { AgentSlotSelector } = await import(
      '@renderer/lib/components/agent-slot/agent-slot-selector'
    );

    await act(async () =>
      root.render(
        createElement(AgentSlotSelector, {
          selectedAgent: agents[0]!,
          agents,
          onSelectAgent: vi.fn(),
          onCreateAgent: vi.fn(),
          onManageAgents: vi.fn(),
        })
      )
    );
    await act(async () => userEvent.click(host.querySelector('button')!));
    await settle();

    const listPopover = document.querySelector<HTMLElement>(
      '[data-slot="popover-content"][data-open]'
    );
    expect(listPopover).not.toBeNull();
    expect(listPopover?.querySelectorAll('button')).toHaveLength(42);
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
