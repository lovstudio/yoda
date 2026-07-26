import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  loadUrl: vi.fn(),
  refresh: vi.fn(),
  selectFile: vi.fn(),
  toast: vi.fn(),
  toastSuccess: vi.fn(),
  update: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@dnd-kit/core', () => {
  return {
    DndContext: ({ children }: { children: ReactNode }) => children,
    PointerSensor: class PointerSensor {},
    pointerWithin: vi.fn(),
    useSensor: vi.fn(() => ({})),
    useSensors: vi.fn(() => []),
  };
});

vi.mock('@dnd-kit/sortable', () => {
  return {
    SortableContext: ({ children }: { children: ReactNode }) => children,
    arrayMove: (items: unknown[]) => items,
    useSortable: () => ({
      attributes: {},
      isDragging: false,
      listeners: {},
      setNodeRef: vi.fn(),
      transform: null,
      transition: undefined,
    }),
    verticalListSortingStrategy: {},
  };
});

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } },
}));

vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({
    value: { items: [] },
    update: mocks.update,
    isLoading: false,
  }),
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  useToast: () => ({
    toast: Object.assign(mocks.toast, { success: mocks.toastSuccess }),
  }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    appSettings: {
      loadPromptPrincipleUrl: mocks.loadUrl,
      refreshPromptPrincipleSource: mocks.refresh,
      selectPromptPrincipleFile: mocks.selectFile,
    },
  },
}));

async function setInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('PromptsSettingsCard', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement('div');
    host.style.width = '440px';
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('imports a selected file as a source-backed principle', async () => {
    mocks.selectFile.mockResolvedValue({
      status: 'success',
      name: 'Imported title',
      text: '# Imported title\n\nContent',
      source: {
        type: 'file',
        path: '/tmp/principle.md',
        lastSyncedAt: '2026-07-27T00:00:00.000Z',
      },
    });
    const { default: PromptsSettingsCard } = await import(
      '@renderer/features/settings/components/PromptsSettingsCard'
    );
    await act(async () => root.render(createElement(PromptsSettingsCard)));

    const button = [...host.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'settings.prompts.addFromFile'
    );
    await act(async () => button?.click());

    expect(mocks.selectFile).toHaveBeenCalledOnce();
    expect(mocks.update).toHaveBeenCalledWith({
      items: [
        expect.objectContaining({
          name: 'Imported title',
          text: '# Imported title\n\nContent',
          enabled: true,
          source: expect.objectContaining({ type: 'file', path: '/tmp/principle.md' }),
        }),
      ],
    });
  });

  it('accepts a URL with interval and timeout before creating the principle', async () => {
    mocks.loadUrl.mockResolvedValue({
      status: 'success',
      name: 'Remote title',
      text: '# Remote title',
      source: {
        type: 'url',
        url: 'https://example.com/rules.md',
        refreshIntervalMinutes: 60,
        timeoutSeconds: 10,
      },
    });
    const { default: PromptsSettingsCard } = await import(
      '@renderer/features/settings/components/PromptsSettingsCard'
    );
    await act(async () => root.render(createElement(PromptsSettingsCard)));

    const addUrlButton = [...host.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'settings.prompts.addFromUrl'
    );
    await act(async () => addUrlButton?.click());

    const urlInput = host.querySelector<HTMLInputElement>('input[type="url"]');
    expect(urlInput).not.toBeNull();
    await setInput(urlInput as HTMLInputElement, 'https://example.com/rules.md');

    const form = host.querySelector('form');
    await act(async () =>
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );

    expect(mocks.loadUrl).toHaveBeenCalledWith({
      url: 'https://example.com/rules.md',
      refreshIntervalMinutes: 60,
      timeoutSeconds: 10,
    });
    expect(mocks.update).toHaveBeenCalledWith({
      items: [
        expect.objectContaining({
          name: 'Remote title',
          source: expect.objectContaining({ type: 'url' }),
        }),
      ],
    });
  });
});
