import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  EditableRuntimeInstructionFile,
  SaveEditableRuntimeInstructionFileRequest,
} from '@shared/conversations';
import type { RuntimeId } from '@shared/runtime-registry';
import type * as PromptSystemModule from '@renderer/features/prompt-library/prompt-system-section';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getDependencies: vi.fn(),
  getFiles: vi.fn(),
  getRuntimeSettings: vi.fn(),
  saveFile: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({
    t: (key: string) => key,
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
      getAll: mocks.getDependencies,
    },
    runtimeSettings: { getAll: mocks.getRuntimeSettings },
    conversations: {
      getEditableRuntimeInstructionFiles: mocks.getFiles,
      saveEditableRuntimeInstructionFile: mocks.saveFile,
    },
  },
}));

function userFiles(runtimeId: RuntimeId): EditableRuntimeInstructionFile[] {
  if (runtimeId === 'codex') {
    return [
      {
        kind: 'global-codex-agents',
        path: '/fixture/.codex/AGENTS.override.md',
        scope: 'user',
        exists: false,
        content: '',
        bytes: 0,
      },
      {
        kind: 'global-codex-agents',
        path: '/fixture/.codex/AGENTS.md',
        scope: 'user',
        exists: true,
        content: 'Codex user prompt',
        bytes: 17,
      },
    ];
  }
  return [
    {
      kind: 'global-claude',
      path: '/fixture/.claude/CLAUDE.md',
      scope: 'user',
      exists: true,
      content: `${runtimeId} user prompt`,
      bytes: 20,
    },
  ];
}

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
    mocks.getDependencies.mockResolvedValue({
      claude: { id: 'claude', category: 'agent', status: 'available' },
      codex: { id: 'codex', category: 'agent', status: 'available' },
      glm: { id: 'glm', category: 'agent', status: 'available' },
      grok: { id: 'grok', category: 'agent', status: 'available' },
    });
    mocks.getRuntimeSettings.mockResolvedValue({});
    mocks.getFiles.mockImplementation(async ({ runtimeId }: { runtimeId: RuntimeId }) =>
      userFiles(runtimeId)
    );
    mocks.saveFile.mockImplementation(
      async (
        request: SaveEditableRuntimeInstructionFileRequest
      ): Promise<EditableRuntimeInstructionFile> => ({
        kind: request.runtimeId === 'codex' ? 'global-codex-agents' : 'global-claude',
        path: request.path,
        scope: request.projectId ? 'project' : 'user',
        exists: true,
        content: request.content,
        bytes: request.content.length,
      })
    );
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

  async function renderSection() {
    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, createElement(Harness))
      );
    });
  }

  it('shows only supported enabled CLIs and edits their standard user files as compact rows', async () => {
    await renderSection();

    await act(async () => {
      await vi.waitFor(() => {
        expect(host.textContent).toContain('Claude Code');
        expect(host.textContent).toContain('Codex');
        expect(host.textContent).toContain('/fixture/.codex/AGENTS.md');
      });
    });

    expect(host.textContent).not.toContain('GLM');
    expect(host.textContent).not.toContain('Grok');
    expect(host.querySelectorAll('[data-slot="tabs-tab"]')).toHaveLength(2);
    expect(host.querySelector('[data-slot="agent-system-prompt"]')).toBeNull();
    expect(host.querySelectorAll('[data-slot="runtime-instruction-file"]')).toHaveLength(2);
    expect(host.querySelector('textarea')).toBeNull();

    const regularAgentsRow = Array.from(
      host.querySelectorAll<HTMLButtonElement>('[data-slot="runtime-instruction-file-toggle"]')
    ).find((button) => !button.textContent?.includes('override'));
    await act(async () => regularAgentsRow?.click());

    const textarea = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="promptLibrary.system.filePromptLabel"]'
    );
    expect(textarea?.value).toBe('Codex user prompt');
    await act(async () => {
      if (textarea) setTextareaValue(textarea, 'Updated Codex user prompt');
    });

    const saveButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('common.save') && !button.disabled
    );
    await act(async () => saveButton?.click());

    expect(mocks.saveFile).toHaveBeenCalledWith({
      runtimeId: 'codex',
      projectId: null,
      path: '/fixture/.codex/AGENTS.md',
      content: 'Updated Codex user prompt',
    });
  });

  it('switches to the standard Claude user instruction path without Agent cards', async () => {
    await renderSection();
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('Claude Code'));
    });

    const claudeTab = Array.from(
      host.querySelectorAll<HTMLButtonElement>('[data-slot="tabs-tab"]')
    ).find((tab) => tab.textContent?.includes('Claude Code'));
    await act(async () => claudeTab?.click());

    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('/fixture/.claude/CLAUDE.md'));
    });
    expect(host.querySelector('[data-slot="agent-system-prompt"]')).toBeNull();
  });

  it('shows RPC failures explicitly instead of claiming that no instruction file exists', async () => {
    mocks.getFiles.mockRejectedValue(new Error('main process needs restart'));
    await renderSection();

    await act(async () => {
      await vi.waitFor(() =>
        expect(host.textContent).toContain('promptLibrary.system.fileLoadFailed')
      );
    });
    expect(host.textContent).not.toContain('promptLibrary.system.noInstructionFiles');
    expect(host.textContent).toContain('common.retry');
  });
});
