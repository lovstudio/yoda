import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prompt, PromptVersionSnapshot } from '@shared/prompt-library';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  createGroup: vi.fn(),
  createPrompt: vi.fn(),
  renameGroup: vi.fn(),
  updatePrompt: vi.fn(),
  deletePrompt: vi.fn(),
  promptGroups: [] as string[],
  prompts: [] as Prompt[],
  promptVersions: [] as PromptVersionSnapshot[],
  refreshPrompt: vi.fn(),
  restorePromptVersion: vi.fn(),
  reorderGroups: vi.fn(),
  reorderPrompts: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) =>
      key === 'promptLibrary.groups.count' ? String(values?.count ?? 0) : key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('@renderer/features/prompt-library/use-prompts', () => ({
  usePrompts: () => ({ data: mocks.prompts, isLoading: false }),
  usePromptGroups: () => ({ data: mocks.promptGroups, isLoading: false }),
  useCreatePromptGroup: () => ({ mutate: mocks.createGroup, isPending: false }),
  useRenamePromptGroup: () => ({ mutate: mocks.renameGroup, isPending: false }),
  useCreatePrompt: () => ({ mutate: mocks.createPrompt, isPending: false }),
  useUpdatePrompt: () => ({ mutate: mocks.updatePrompt, isPending: false }),
  useDeletePrompt: () => ({ mutate: mocks.deletePrompt }),
  useReorderPromptGroups: () => ({ mutate: mocks.reorderGroups, isPending: false }),
  useReorderPrompts: () => ({ mutate: mocks.reorderPrompts, isPending: false }),
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
    ProjectPromptSection: ({ runtimeId }: { runtimeId: string | null }) =>
      React.createElement('section', {
        'data-slot': 'project-prompt-section',
        'data-runtime-id': runtimeId ?? '',
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
  useShowModal: () => vi.fn(),
}));

function prompt(id: string, groupName: string): Prompt {
  return {
    id,
    title: id,
    description: `${id} description`,
    content: `${id} content`,
    groupName,
    extraInfo: '',
    injectionEnabled: false,
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

describe('PromptLibraryPanel groups', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prompts = [
      prompt('review-first', 'Review'),
      prompt('build-first', 'Build'),
      prompt('ungrouped-first', ''),
      prompt('review-second', 'Review'),
    ];
    mocks.promptGroups = ['Build', 'Review'];
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

  it('renders named and ungrouped sections and collapses a whole group', async () => {
    const { PromptLibraryPanel } = await import(
      '@renderer/features/prompt-library/prompt-library-panel'
    );
    await act(async () => root.render(createElement(PromptLibraryPanel, { embedded: true })));

    const groupButtons = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).filter(
      (button) =>
        button.textContent?.includes('Build') ||
        button.textContent?.includes('Review') ||
        button.textContent?.includes('promptLibrary.groups.ungrouped')
    );
    expect(groupButtons).toHaveLength(3);
    expect(host.textContent).toContain('review-first');
    expect(host.textContent).toContain('review-second');

    const reviewGroup = groupButtons.find((button) => button.textContent?.includes('Review'));
    expect(reviewGroup?.getAttribute('aria-expanded')).toBe('true');
    await act(async () => reviewGroup?.click());

    expect(reviewGroup?.getAttribute('aria-expanded')).toBe('false');
    expect(host.textContent).not.toContain('review-first');
    expect(host.textContent).not.toContain('review-second');
    expect(host.textContent).toContain('build-first');
  });

  it('offers existing groups while allowing a new group name', async () => {
    const { PromptLibraryPanel } = await import(
      '@renderer/features/prompt-library/prompt-library-panel'
    );
    await act(async () => root.render(createElement(PromptLibraryPanel, { embedded: true })));

    const newPromptButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('promptLibrary.source.manual')
    );
    await act(async () => newPromptButton?.click());

    const groupInput = host.querySelector<HTMLInputElement>(
      'input[placeholder="promptLibrary.form.groupPlaceholder"]'
    );
    expect(groupInput).not.toBeNull();

    const listId = groupInput?.getAttribute('list');
    const options = Array.from(
      host.querySelectorAll<HTMLOptionElement>(`datalist#${CSS.escape(listId ?? '')} option`)
    ).map((option) => option.value);
    expect(options).toEqual(['Build', 'Review']);

    const titleInput = host.querySelector<HTMLInputElement>(
      'input[placeholder="promptLibrary.form.titlePlaceholder"]'
    );
    const contentInput = host.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="promptLibrary.form.contentPlaceholder"]'
    );
    await act(async () => {
      if (!titleInput || !contentInput || !groupInput) return;
      setFormValue(titleInput, 'Release note');
      setFormValue(contentInput, 'Write a concise release note.');
      setFormValue(groupInput, 'Writing');
    });
    expect(groupInput?.value).toBe('Writing');

    const form = host.querySelector('form');
    await act(async () => form?.requestSubmit());
    expect(mocks.createPrompt).toHaveBeenCalledWith(
      {
        title: 'Release note',
        description: '',
        content: 'Write a concise release note.',
        groupName: 'Writing',
        extraInfo: '',
        injectionEnabled: false,
        source: undefined,
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      })
    );
  });

  it('creates a prompt directly inside a group', async () => {
    const { PromptLibraryPanel } = await import(
      '@renderer/features/prompt-library/prompt-library-panel'
    );
    await act(async () => root.render(createElement(PromptLibraryPanel, { embedded: true })));

    const createInBuildButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="promptLibrary.groups.createPrompt"]'
    );
    expect(createInBuildButton).not.toBeNull();
    await act(async () => createInBuildButton?.click());

    const editor = host.querySelector<HTMLFormElement>('form[data-slot="prompt-library-editor"]');
    const titleInput = editor?.querySelector<HTMLInputElement>(
      'input[placeholder="promptLibrary.form.titlePlaceholder"]'
    );
    const groupInput = editor?.querySelector<HTMLInputElement>(
      'input[placeholder="promptLibrary.form.groupPlaceholder"]'
    );
    const contentInput = editor?.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="promptLibrary.form.contentPlaceholder"]'
    );
    expect(groupInput?.value).toBe('Build');

    await act(async () => {
      if (!titleInput || !contentInput) return;
      setFormValue(titleInput, 'Build prompt');
      setFormValue(contentInput, 'Build the project.');
    });
    await act(async () => editor?.requestSubmit());

    expect(mocks.createPrompt).toHaveBeenCalledWith(
      {
        title: 'Build prompt',
        description: '',
        content: 'Build the project.',
        groupName: 'Build',
        extraInfo: '',
        injectionEnabled: false,
        source: undefined,
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      })
    );
  });

  it('creates an empty persisted group from the collection header', async () => {
    const { PromptLibraryPanel } = await import(
      '@renderer/features/prompt-library/prompt-library-panel'
    );
    await act(async () => root.render(createElement(PromptLibraryPanel, { embedded: true })));

    const createGroupButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('promptLibrary.groups.create')
    );
    await act(async () => createGroupButton?.click());

    const groupNameInput = host.querySelector<HTMLInputElement>(
      'input[placeholder="promptLibrary.groups.namePlaceholder"]'
    );
    expect(groupNameInput).not.toBeNull();
    await act(async () => {
      if (groupNameInput) setFormValue(groupNameInput, 'Writing');
    });

    const groupForm = host.querySelector<HTMLFormElement>('form[data-slot="prompt-group-form"]');
    await act(async () => groupForm?.requestSubmit());

    expect(mocks.createGroup).toHaveBeenCalledWith(
      'Writing',
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      })
    );
  });

  it('renames a named group from its header', async () => {
    const { PromptLibraryPanel } = await import(
      '@renderer/features/prompt-library/prompt-library-panel'
    );
    await act(async () => root.render(createElement(PromptLibraryPanel, { embedded: true })));

    const renameBuildButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="promptLibrary.groups.rename"]'
    );
    expect(renameBuildButton).not.toBeNull();
    await act(async () => renameBuildButton?.click());

    const renameForm = host.querySelector<HTMLFormElement>(
      'form[data-slot="prompt-group-rename-form"]'
    );
    const nameInput = renameForm?.querySelector<HTMLInputElement>(
      'input[placeholder="promptLibrary.groups.namePlaceholder"]'
    );
    expect(nameInput?.value).toBe('Build');
    await act(async () => {
      if (nameInput) setFormValue(nameInput, 'Delivery');
    });
    await act(async () => renameForm?.requestSubmit());

    expect(mocks.renameGroup).toHaveBeenCalledWith(
      { currentName: 'Build', nextName: 'Delivery' },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      })
    );
  });

  it('moves a prompt to another persisted group', async () => {
    const { PromptLibraryPanel } = await import(
      '@renderer/features/prompt-library/prompt-library-panel'
    );
    await act(async () => root.render(createElement(PromptLibraryPanel, { embedded: true })));

    const moveButtons = Array.from(
      host.querySelectorAll<HTMLButtonElement>('button[aria-label="promptLibrary.groups.move"]')
    );
    expect(moveButtons.length).toBeGreaterThan(0);
    await act(async () => moveButtons[0]?.click());

    const reviewItem = Array.from(
      document.body.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-radio-item"]')
    ).find((item) => item.textContent?.includes('Review'));
    expect(reviewItem).toBeDefined();
    await act(async () => reviewItem?.click());

    expect(mocks.updatePrompt).toHaveBeenCalledWith(
      { id: 'build-first', patch: { groupName: 'Review' } },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it('keeps group headings informational and toggles prompts individually', async () => {
    const { PromptLibraryPanel } = await import(
      '@renderer/features/prompt-library/prompt-library-panel'
    );
    await act(async () => root.render(createElement(PromptLibraryPanel, { embedded: true })));

    expect(host.querySelector('[data-slot="prompt-group-injection-toggle"]')).toBeNull();
    const promptToggles = Array.from(
      host.querySelectorAll<HTMLButtonElement>(
        '[data-slot="switch"][aria-label="promptLibrary.injection.toggle"]'
      )
    );
    expect(promptToggles).toHaveLength(4);
    await act(async () => promptToggles[0]?.click());

    expect(mocks.updatePrompt).toHaveBeenCalledWith({
      id: 'build-first',
      patch: { injectionEnabled: true },
    });
  });

  it('keeps bottom breathing room in the full panel', async () => {
    const { PromptLibraryPanel } = await import(
      '@renderer/features/prompt-library/prompt-library-panel'
    );
    await act(async () => root.render(createElement(PromptLibraryPanel)));

    expect(host.querySelector('[data-slot="prompt-library-bottom-space"].h-24')).not.toBeNull();
  });

  it('puts reusable prompts first and keeps CLI and project instruction chapters together', async () => {
    const { PromptLibraryPanel } = await import(
      '@renderer/features/prompt-library/prompt-library-panel'
    );
    await act(async () => root.render(createElement(PromptLibraryPanel, { embedded: true })));

    const runtime = host.querySelector('[data-slot="prompt-runtime-selector"]');
    const user = host.querySelector('[data-slot="user-instruction-section"]');
    const project = host.querySelector('[data-slot="project-prompt-section"]');
    const collection = host.querySelector('[data-slot="prompt-collection-section"]');
    const promptList = host.querySelector('[data-slot="prompt-list-section"]');
    const promptListHeading = Array.from(host.querySelectorAll('h2')).find((heading) =>
      heading.textContent?.includes('promptLibrary.collection.all')
    );

    expect(collection).not.toBeNull();
    expect(runtime).not.toBeNull();
    expect(user).not.toBeNull();
    expect(project).not.toBeNull();
    expect(promptList).not.toBeNull();
    expect(promptListHeading).not.toBeNull();
    expect(promptListHeading?.closest('section')).toBe(promptList);
    if (!collection || !runtime || !user || !project || !promptList) {
      throw new Error('Prompt layer sections are missing');
    }
    expect(collection.compareDocumentPosition(runtime) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(runtime.compareDocumentPosition(user) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(user.compareDocumentPosition(project) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(project.compareDocumentPosition(promptList) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );

    const claudeButton = runtime.querySelector<HTMLButtonElement>('button');
    await act(async () => claudeButton?.click());
    expect(user.getAttribute('data-runtime-id')).toBe('claude');
    expect(project.getAttribute('data-runtime-id')).toBe('claude');
  });

  it('removes the separate injection order card and keyboard-sorts prompt rows within a group', async () => {
    mocks.prompts = [
      { ...prompt('second', 'Review'), injectionEnabled: true, injectionOrder: 20 },
      { ...prompt('first', 'Review'), injectionEnabled: true, injectionOrder: 10 },
    ];
    mocks.promptGroups = ['Review'];
    const { PromptLibraryPanel } = await import(
      '@renderer/features/prompt-library/prompt-library-panel'
    );
    await act(async () => root.render(createElement(PromptLibraryPanel, { embedded: true })));

    expect(host.textContent).not.toContain('promptLibrary.injection.title');
    const rows = Array.from(host.querySelectorAll('[data-slot="prompt-library-row"]'));
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('second'),
      expect.stringContaining('first'),
    ]);

    const dragHandles = Array.from(
      host.querySelectorAll<HTMLButtonElement>(
        'button[aria-label="promptLibrary.groups.reorderPrompt"]'
      )
    );
    expect(dragHandles).toHaveLength(2);
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
    expect(mocks.reorderPrompts).toHaveBeenCalledWith({
      groupName: 'Review',
      ids: ['first', 'second'],
    });
  });

  it('keyboard-sorts named group cards while keeping Ungrouped fixed', async () => {
    const { PromptLibraryPanel } = await import(
      '@renderer/features/prompt-library/prompt-library-panel'
    );
    await act(async () => root.render(createElement(PromptLibraryPanel, { embedded: true })));

    const dragHandles = Array.from(
      host.querySelectorAll<HTMLButtonElement>(
        'button[aria-label="promptLibrary.groups.reorderGroup"]'
      )
    );
    expect(dragHandles).toHaveLength(2);
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
    expect(mocks.reorderGroups).toHaveBeenCalledWith(['Review', 'Build']);
  });

  it('shows semantic versions and saves authored edits as a new patch version', async () => {
    mocks.prompts = [{ ...prompt('review', 'Review'), version: '1.2.0' }];
    mocks.promptGroups = ['Review'];
    mocks.promptVersions = [
      {
        id: 'version-1.2.0',
        promptId: 'review',
        version: '1.2.0',
        title: 'review',
        description: 'review description',
        content: 'review content',
        extraInfo: '',
        createdAt: '2026-07-27T00:00:00.000Z',
      },
      {
        id: 'version-1.1.0',
        promptId: 'review',
        version: '1.1.0',
        title: 'review',
        description: 'review description',
        content: 'older content',
        extraInfo: '',
        createdAt: '2026-07-26T00:00:00.000Z',
      },
    ];
    const { PromptLibraryPanel } = await import(
      '@renderer/features/prompt-library/prompt-library-panel'
    );
    await act(async () => root.render(createElement(PromptLibraryPanel, { embedded: true })));

    expect(host.textContent).toContain('v1.2.0');
    const rowToggle = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) =>
        button.getAttribute('aria-expanded') === 'false' && button.textContent?.includes('review')
    );
    await act(async () => rowToggle?.click());
    expect(host.querySelector('[data-slot="prompt-version-history"]')?.textContent).toContain(
      'v1.1.0'
    );

    const editButton = host.querySelector<HTMLButtonElement>('button[aria-label="common.edit"]');
    await act(async () => editButton?.click());
    const editor = host.querySelector<HTMLFormElement>('form[data-slot="prompt-library-editor"]');
    const content = editor?.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="promptLibrary.form.contentPlaceholder"]'
    );
    await act(async () => {
      if (content) setFormValue(content, 'updated review content');
    });
    expect(editor?.textContent).toContain('promptLibrary.versions.saveAs');
    await act(async () => editor?.requestSubmit());

    expect(mocks.updatePrompt).toHaveBeenCalledWith(
      {
        id: 'review',
        patch: expect.objectContaining({
          content: 'updated review content',
          versionBump: 'patch',
        }),
      },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) })
    );
  });
});
