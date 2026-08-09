import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prompt, PromptVersionSnapshot } from '@shared/prompt-library';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  createPrompt: vi.fn(),
  deletePrompt: vi.fn(),
  updatePrompt: vi.fn(),
  prompts: [] as Prompt[],
  promptVersions: [] as PromptVersionSnapshot[],
  refreshPrompt: vi.fn(),
  restorePromptVersion: vi.fn(),
  reorderPrompts: vi.fn(),
  setTagInjectionEnabled: vi.fn(),
  showConfirm: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('@renderer/features/prompt-library/use-prompts', () => ({
  usePrompts: () => ({ data: mocks.prompts, isLoading: false }),
  useCreatePrompt: () => ({ mutate: mocks.createPrompt, isPending: false }),
  useUpdatePrompt: () => ({ mutate: mocks.updatePrompt, isPending: false }),
  useDeletePrompt: () => ({ mutate: mocks.deletePrompt, isPending: false }),
  useReorderPrompts: () => ({ mutate: mocks.reorderPrompts, isPending: false }),
  useSetTagInjectionEnabled: () => ({ mutate: mocks.setTagInjectionEnabled, isPending: false }),
  useRefreshPromptSource: () => ({ mutate: mocks.refreshPrompt, isPending: false }),
  usePromptVersions: () => ({ data: mocks.promptVersions, isLoading: false }),
  useRestorePromptVersion: () => ({ mutate: mocks.restorePromptVersion, isPending: false }),
}));

vi.mock('@renderer/features/prompt-library/prompt-system-section', async () => {
  const React = await import('react');
  return {
    PromptRuntimeSelector: ({
      onRuntimeIdChange,
    }: {
      onRuntimeIdChange: (runtimeId: 'codex' | 'claude') => void;
    }) =>
      React.createElement(
        'section',
        { 'data-slot': 'prompt-runtime-selector' },
        React.createElement(
          'button',
          { type: 'button', onClick: () => onRuntimeIdChange('claude') },
          'Claude Code'
        )
      ),
    UserInstructionSection: ({ runtimeId }: { runtimeId: string | null }) =>
      React.createElement('section', {
        'data-slot': 'user-instruction-section',
        'data-runtime-id': runtimeId ?? '',
      }),
  };
});

vi.mock('@renderer/features/prompt-library/project-prompt-section', async () => {
  const React = await import('react');
  return {
    ProjectPromptSection: ({
      runtimeId,
      projectId,
    }: {
      runtimeId: string | null;
      projectId: string | null;
    }) =>
      React.createElement('section', {
        'data-slot': 'project-prompt-section',
        'data-runtime-id': runtimeId ?? '',
        'data-project-id': projectId ?? '',
      }),
  };
});

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    app: { openExternal: vi.fn() },
    promptLibrary: {
      loadGit: vi.fn(),
      loadUrl: vi.fn(),
      selectFile: vi.fn(),
    },
  },
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  useShowModal: () => mocks.showConfirm,
}));

function prompt(id: string, tags: string[], injectionEnabled = false): Prompt {
  return {
    id,
    title: id,
    description: `${id} description`,
    content: `${id} content`,
    tags,
    extraInfo: '',
    injectionEnabled,
    injectionOrder: 0,
    version: '1.0.0',
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
  };
}

function setFormValue(control: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(control, value);
  control.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('PromptLibraryPanel tags', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prompts = [
      prompt('review-first', ['Review', 'Writing'], true),
      prompt('build-first', ['Build']),
      prompt('review-second', ['Review']),
    ];
    mocks.promptVersions = [];
    host = document.createElement('div');
    host.style.width = '440px';
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('renders one flat sortable list with human-only tag badges', async () => {
    const { PromptLibraryPanel } = await import(
      '@renderer/features/prompt-library/prompt-library-panel'
    );
    await act(async () => root.render(createElement(PromptLibraryPanel, { embedded: true })));

    expect(host.querySelectorAll('[data-slot="prompt-library-row"]')).toHaveLength(3);
    expect(host.querySelectorAll('[data-slot="prompt-group"]')).toHaveLength(0);
    expect(host.textContent).toContain('Review');
    expect(host.textContent).toContain('Writing');
  });

  it('creates a prompt with comma-separated tags', async () => {
    const { PromptLibraryPanel } = await import(
      '@renderer/features/prompt-library/prompt-library-panel'
    );
    await act(async () => root.render(createElement(PromptLibraryPanel, { embedded: true })));

    const createButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('promptLibrary.source.manual')
    );
    await act(async () => createButton?.click());

    const title = host.querySelector<HTMLInputElement>(
      'input[placeholder="promptLibrary.form.titlePlaceholder"]'
    );
    const tags = host.querySelector<HTMLInputElement>(
      'input[placeholder="promptLibrary.form.tagsPlaceholder"]'
    );
    const content = host.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="promptLibrary.form.contentPlaceholder"]'
    );
    await act(async () => {
      if (title && tags && content) {
        setFormValue(title, 'Release note');
        setFormValue(tags, 'Writing, Release');
        setFormValue(content, 'Write a concise release note.');
      }
    });
    await act(async () =>
      host.querySelector('form[data-slot="prompt-library-editor"]')?.requestSubmit()
    );

    expect(mocks.createPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Release note',
        content: 'Write a concise release note.',
        tags: ['Writing', 'Release'],
      }),
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it('filters by tag and enables all prompts carrying that tag', async () => {
    const { PromptLibraryPanel } = await import(
      '@renderer/features/prompt-library/prompt-library-panel'
    );
    await act(async () => root.render(createElement(PromptLibraryPanel, { embedded: true })));

    const tagFilter = host.querySelector<HTMLButtonElement>(
      'button[aria-label="promptLibrary.filters.tags"]'
    );
    await act(async () => tagFilter?.click());
    const reviewOption = Array.from(
      document.body.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-radio-item"]')
    ).find((item) => item.textContent?.includes('Review'));
    await act(async () => reviewOption?.click());

    expect(
      Array.from(host.querySelectorAll('[data-slot="prompt-library-row"]')).map(
        (row) => row.textContent
      )
    ).toEqual([expect.stringContaining('review-first'), expect.stringContaining('review-second')]);

    const enableAll = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('promptLibrary.filters.enableTag')
    );
    await act(async () => enableAll?.click());
    expect(mocks.setTagInjectionEnabled).toHaveBeenCalledWith({ tag: 'Review', enabled: true });
  });

  it('keyboard-reorders the complete flat list', async () => {
    const { PromptLibraryPanel } = await import(
      '@renderer/features/prompt-library/prompt-library-panel'
    );
    await act(async () => root.render(createElement(PromptLibraryPanel, { embedded: true })));

    const dragHandles = Array.from(
      host.querySelectorAll<HTMLButtonElement>('button[aria-label="promptLibrary.reorder"]')
    );
    expect(dragHandles).toHaveLength(3);
    dragHandles[0]?.focus();
    await act(async () => {
      dragHandles[0]?.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })
      );
    });
    await act(async () => {
      dragHandles[0]?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true })
      );
    });
    await act(async () => {
      dragHandles[0]?.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })
      );
    });

    expect(mocks.reorderPrompts).toHaveBeenCalledWith([
      'build-first',
      'review-first',
      'review-second',
    ]);
  });

  it('keeps global, project, and dynamic settings in separate tabs', async () => {
    const { PromptLibraryPanel } = await import(
      '@renderer/features/prompt-library/prompt-library-panel'
    );
    await act(async () => root.render(createElement(PromptLibraryPanel, { embedded: true })));

    expect(host.querySelector('[data-slot="prompt-collection-section"]')).not.toBeNull();
    const tabs = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'promptLibrary.tabs.global',
      'promptLibrary.tabs.project',
      'promptLibrary.tabs.dynamic',
    ]);
    await act(async () => tabs[0]?.click());
    expect(host.querySelector('[data-slot="user-instruction-section"]')).not.toBeNull();
  });
});
