import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { Agent } from '@shared/agents';
import type { ModelProviderCatalogResult } from '@shared/model-provider-catalog';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  listModelProviders: vi.fn(),
  updateAgent: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: { llm: { listModelProviders: mocks.listModelProviders } },
}));

vi.mock('@renderer/features/agents-config/use-agents', () => ({
  useAgents: () => ({ create: vi.fn(), update: mocks.updateAgent }),
}));

vi.mock('@renderer/features/skills/components/useSkills', () => ({
  useSkills: () => ({ installedSkills: [], isLoading: false }),
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({ value: 'codex' }),
}));

vi.mock('@renderer/lib/modal/use-close-guard', () => ({ useCloseGuard: vi.fn() }));

vi.mock('@renderer/lib/ui/confirm-button', () => ({
  ConfirmButton: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@renderer/lib/components/agent-selector/agent-selector', () => ({
  AgentSelector: ({ emptyLabel }: { emptyLabel?: string }) => (
    <button type="button">{emptyLabel}</button>
  ),
}));

vi.mock('@renderer/lib/ui/dialog', () => ({
  DialogContentArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

describe('AgentEditModal', () => {
  let host: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateAgent.mockImplementation(async ({ draft }: { draft: Agent }) => draft);
    mocks.listModelProviders.mockResolvedValue(catalogResult());
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    host = document.createElement('div');
    host.style.width = '720px';
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    document.querySelectorAll('[data-slot="combobox-content"]').forEach((node) => node.remove());
    host.remove();
  });

  it('uses a profile avatar, marks only name required, and saves custom runtime settings', async () => {
    const { AgentEditModal } = await import('@renderer/features/agents-config/agent-edit-modal');
    const agent = fixtureAgent();
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(AgentEditModal, {
            agent,
            onClose: vi.fn(),
            onSuccess: vi.fn(),
          })
        )
      );
    });
    await settle();

    const nameInput = host.querySelector<HTMLInputElement>('#agent-name');
    expect(nameInput?.required).toBe(true);
    expect(host.querySelectorAll('[required]')).toHaveLength(1);
    expect(host.querySelector('[aria-label="common.uploadPhoto"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="common.clearAvatar"]')).toBeNull();
    expect(host.textContent).toContain('agentManager.optional');

    const modelInput = host.querySelector<HTMLInputElement>('#agent-model');
    expect(modelInput).not.toBeNull();
    await clickUser(host.querySelector('[aria-label="agentManager.modelCandidates"]')!);
    await settle();
    const candidate = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="combobox-item"]')
    ).find((item) => item.textContent?.includes('gpt-5.6-sol'));
    expect(candidate).not.toBeUndefined();
    await clickUser(candidate!);
    expect(modelInput?.value).toBe('gpt-5.6-sol');
    await act(async () => {
      await userEvent.fill(modelInput!, 'custom/reasoner-v2');
    });
    await act(async () => {
      await userEvent.keyboard('{Escape}');
    });
    await clickUser(host.querySelector('label:has([value="plan"])')!);
    const save = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === 'common.save'
    );
    await clickUser(save!);
    await settle();

    expect(mocks.updateAgent).toHaveBeenCalledWith({
      id: agent.id,
      draft: expect.objectContaining({
        name: 'Planner Agent',
        icon: '',
        model: 'custom/reasoner-v2',
        reasoningEffort: 'high',
        accessMode: 'plan',
      }),
    });
  });
});

function fixtureAgent(): Agent {
  return {
    id: 'agent-1',
    slug: 'planner-agent',
    name: 'Planner Agent',
    description: '',
    icon: '',
    systemPrompt: '',
    enabledSkillIds: [],
    manualSkillIds: [],
    skillPolicyMode: 'runtime-defaults',
    preferredRuntime: 'codex',
    model: null,
    reasoningEffort: 'high',
    accessMode: 'write',
    source: 'local',
    createdAt: '',
    updatedAt: '',
  };
}

function catalogResult(): ModelProviderCatalogResult {
  return {
    providers: [
      {
        id: 'openai',
        name: 'OpenAI',
        custom: false,
        models: [{ id: 'openai/gpt-5.6-sol', custom: false, sources: ['aggregate'] }],
        customModels: [],
        officialSourceUrl: null,
        officialSnapshotAt: null,
        officialFetchedAt: null,
        lastUpdateAttemptAt: null,
        officialApiSupported: false,
        officialApiConfigured: false,
        updateStatus: 'aggregateOnly',
      },
    ],
    fetchedAt: new Date().toISOString(),
    automaticUpdatesEnabled: true,
    lastAutomaticRefreshAt: null,
    nextAutomaticRefreshAt: null,
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function clickUser(element: Element): Promise<void> {
  await act(async () => {
    await userEvent.click(element);
  });
}
