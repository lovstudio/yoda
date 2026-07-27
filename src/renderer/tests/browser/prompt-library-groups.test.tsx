import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prompt } from '@shared/prompt-library';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  createPrompt: vi.fn(),
  updatePrompt: vi.fn(),
  deletePrompt: vi.fn(),
  prompts: [] as Prompt[],
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) =>
      key === 'promptLibrary.groups.count' ? String(values?.count ?? 0) : key,
  }),
}));

vi.mock('@renderer/features/settings/components/PromptsSettingsCard', () => ({
  default: () => null,
}));

vi.mock('@renderer/features/prompt-library/leaked-prompts-reference', () => ({
  LeakedPromptsReference: () => null,
}));

vi.mock('@renderer/features/prompt-library/use-prompts', () => ({
  usePrompts: () => ({ data: mocks.prompts, isLoading: false }),
  useCreatePrompt: () => ({ mutate: mocks.createPrompt }),
  useUpdatePrompt: () => ({ mutate: mocks.updatePrompt }),
  useDeletePrompt: () => ({ mutate: mocks.deletePrompt }),
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
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
      (button) => button.textContent?.includes('promptLibrary.new')
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
      },
      expect.objectContaining({ onError: expect.any(Function) })
    );
  });
});
