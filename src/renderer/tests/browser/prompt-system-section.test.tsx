import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '@shared/agents';
import type { EditableRuntimeInstructionFile } from '@shared/conversations';
import type { RuntimeId } from '@shared/runtime-registry';
import type * as PromptSystemModule from '@renderer/features/prompt-library/prompt-system-section';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  updateAgent: vi.fn(),
  saveFile: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { exists: () => false },
  }),
}));

const agents: Agent[] = [
  {
    id: 'claude-agent',
    slug: 'claude-agent',
    name: 'Claude Agent',
    description: '',
    icon: 'C',
    systemPrompt: 'Claude system prompt',
    enabledSkillIds: [],
    manualSkillIds: [],
    preferredRuntime: 'claude',
    model: null,
    source: 'local',
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
  },
  {
    id: 'codex-agent',
    slug: 'codex-agent',
    name: 'Codex Agent',
    description: '',
    icon: 'X',
    systemPrompt: 'Codex system prompt',
    enabledSkillIds: [],
    manualSkillIds: [],
    preferredRuntime: 'codex',
    model: null,
    source: 'local',
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
  },
];

vi.mock('@renderer/features/agents-config/use-agents', () => ({
  useAgents: () => ({
    agents,
    isLoading: false,
    update: mocks.updateAgent,
    isMutating: false,
  }),
}));

vi.mock('@renderer/lib/components/file-path-actions', () => ({
  GlobalFileActionsDropdown: () => null,
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    dependencies: {
      probeCategory: vi.fn(),
      getAll: vi.fn(async () => ({
        claude: { id: 'claude', category: 'agent', status: 'available' },
        codex: { id: 'codex', category: 'agent', status: 'available' },
        devin: { id: 'devin', category: 'agent', status: 'missing' },
      })),
    },
    runtimeSettings: { getAll: vi.fn(async () => ({})) },
    conversations: {
      getEditableRuntimeInstructionFiles: vi.fn(
        async ({ runtimeId }: { runtimeId: RuntimeId }) =>
          [
            {
              kind: runtimeId === 'codex' ? 'global-codex-agents' : 'global-claude',
              path:
                runtimeId === 'codex' ? '/fixture/.codex/AGENTS.md' : '/fixture/.claude/CLAUDE.md',
              scope: 'user',
              exists: true,
              content: `${runtimeId} user prompt`,
              bytes: 20,
            },
          ] satisfies EditableRuntimeInstructionFile[]
      ),
      saveEditableRuntimeInstructionFile: mocks.saveFile,
    },
  },
}));

function setTextareaValue(control: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(control, value);
  control.dispatchEvent(new Event('input', { bubbles: true }));
}

function Harness() {
  const [runtimeId, setRuntimeId] = useState<RuntimeId | null>(null);
  const { PromptSystemSection } = requirePromptSystemSection();
  return createElement(PromptSystemSection, {
    runtimeId,
    onRuntimeIdChange: setRuntimeId,
  });
}

let promptSystemModule: typeof PromptSystemModule | undefined;

function requirePromptSystemSection() {
  if (!promptSystemModule) throw new Error('Prompt system module has not loaded');
  return promptSystemModule;
}

describe('PromptSystemSection', () => {
  let host: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.updateAgent.mockResolvedValue(agents[0]);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    promptSystemModule = await import('@renderer/features/prompt-library/prompt-system-section');
    host = document.createElement('div');
    host.style.width = '440px';
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    host.remove();
  });

  it('lists enabled Agent CLIs as tabs and edits the selected Agent system prompt', async () => {
    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, createElement(Harness))
      );
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect(host.textContent).toContain('Claude Code');
        expect(host.textContent).toContain('Codex');
        expect(host.textContent).toContain('Codex Agent');
      });
    });

    const claudeTab = Array.from(
      host.querySelectorAll<HTMLButtonElement>('[data-slot="tabs-tab"]')
    ).find((tab) => tab.textContent?.includes('Claude Code'));
    await act(async () => claudeTab?.click());

    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('Claude Agent'));
    });
    const textarea = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="promptLibrary.system.agentPromptLabel"]'
    );
    expect(textarea?.value).toBe('Claude system prompt');
    await act(async () => {
      if (textarea) setTextareaValue(textarea, 'Updated Claude prompt');
    });

    const saveButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('common.save') && !button.disabled
    );
    await act(async () => saveButton?.click());

    expect(mocks.updateAgent).toHaveBeenCalledWith({
      id: 'claude-agent',
      draft: expect.objectContaining({
        name: 'Claude Agent',
        preferredRuntime: 'claude',
        systemPrompt: 'Updated Claude prompt',
      }),
    });
  });
});
