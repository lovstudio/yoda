import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type {
  ModelProviderCatalogGroup,
  ModelProviderCatalogResult,
} from '@shared/model-provider-catalog';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getRuntimeSettings: vi.fn(),
  listModelProviders: vi.fn(),
  manageModels: vi.fn(),
  restartWithModel: vi.fn(),
  showConfirm: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  updateRuntimeSettings: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({
    t: (key: string, values?: { effort?: string; model?: string; provider?: string }) => {
      if (values?.model) return `${key}:${values.model}`;
      if (values?.provider) return `${key}:${values.provider}`;
      if (values?.effort) return `${key}:${values.effort}`;
      return key;
    },
  }),
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  useToast: () => ({
    toast: Object.assign(vi.fn(), {
      error: mocks.toastError,
      success: mocks.toastSuccess,
    }),
  }),
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  useShowModal: () => mocks.showConfirm,
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    llm: {
      listModelProviders: mocks.listModelProviders,
    },
    runtimeSettings: {
      getItemWithMeta: mocks.getRuntimeSettings,
      resetItem: vi.fn(),
      updateItem: mocks.updateRuntimeSettings,
    },
  },
}));

describe('SessionModelEditor', () => {
  let host: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listModelProviders.mockResolvedValue(
      catalogResult([
        providerGroup('openai', 'OpenAI', ['openai/gpt-5.5']),
        providerGroup('anthropic', 'Anthropic', ['anthropic/claude-sonnet-4.6']),
        providerGroup('siliconflow', 'SiliconFlow', ['siliconflow/deepseek-v3.2']),
      ])
    );
    mocks.getRuntimeSettings.mockResolvedValue({
      value: {
        cli: 'codex',
        defaultModel: 'gpt-5.5',
        defaultReasoningEffort: 'medium',
        defaultFastMode: false,
        extraArgs: '--search',
      },
      defaults: { cli: 'codex' },
      overrides: {
        defaultModel: 'gpt-5.5',
        defaultReasoningEffort: 'medium',
        defaultFastMode: false,
        extraArgs: '--search',
      },
    });
    mocks.updateRuntimeSettings.mockResolvedValue(undefined);
    mocks.restartWithModel.mockResolvedValue(undefined);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    host = document.createElement('div');
    host.style.width = '320px';
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    document.querySelectorAll('[data-slot="combobox-content"]').forEach((node) => node.remove());
    host.remove();
  });

  it('selects from the shared catalog, restarts the session, and preserves other defaults', async () => {
    await renderEditor(root, queryClient);

    expect(host.textContent).toContain('gpt-5.5');
    expect(host.textContent).toContain('workspaceRuntime.model.reasoning.high');
    const settings = host.querySelector('[data-testid="session-model-settings"]');
    expect(settings).not.toBeNull();
    expect(settings?.children).toHaveLength(3);
    expect(host.querySelector('[data-testid="session-model-model-row"]')?.parentElement).toBe(
      settings
    );
    expect(host.querySelector('[data-testid="session-model-reasoning-row"]')?.parentElement).toBe(
      settings
    );
    expect(host.querySelector('[data-testid="session-model-fast-mode-row"]')?.parentElement).toBe(
      settings
    );
    expect(host.querySelector('[data-testid="session-model-actions"]')).toBeNull();
    expect(host.textContent).not.toContain('workspaceRuntime.model.defaultModel');
    expect(host.textContent).not.toContain('workspaceRuntime.model.defaultParameters');

    await openModelPicker(host);
    const option = await waitForComboboxItem('claude-sonnet-4-6');
    expect(option).not.toBeUndefined();
    await clickUser(option!);
    await settle();
    expect(host.querySelector('[data-testid="session-model-actions"]')).not.toBeNull();

    await chooseReasoningEffort(host, 'workspaceRuntime.model.reasoning.xhigh');
    const fastSwitch = host.querySelector<HTMLElement>('[data-slot="switch"]');
    const fastLabel = host.querySelector<HTMLLabelElement>(
      '[data-testid="session-model-fast-mode-label"]'
    );
    expect(fastSwitch).not.toBeNull();
    expect(fastLabel).not.toBeNull();
    await clickUser(fastLabel!);
    await settle();
    expect(fastSwitch?.getAttribute('aria-checked')).toBe('true');

    await clickButtonContaining(host, 'workspaceRuntime.model.restartCurrent');
    expect(mocks.showConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'workspaceRuntime.model.restartTitle',
        description: 'workspaceRuntime.model.restartDescriptionWithParameters:claude-sonnet-4-6',
        confirmLabel: 'workspaceRuntime.model.restartConfirm',
      })
    );
    const confirmArgs = mocks.showConfirm.mock.calls.at(-1)?.[0] as
      | { onSuccess: () => void }
      | undefined;
    await act(async () => confirmArgs?.onSuccess());
    await settle();

    expect(mocks.restartWithModel).toHaveBeenCalledWith({
      model: 'claude-sonnet-4-6',
      reasoningEffort: 'xhigh',
      fastMode: true,
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      'workspaceRuntime.model.restartSuccessWithParameters:claude-sonnet-4-6'
    );

    await clickButtonContaining(host, 'workspaceRuntime.model.setDefault');
    await settle();
    expect(mocks.updateRuntimeSettings).toHaveBeenCalledWith('codex', {
      cli: 'codex',
      defaultModel: 'claude-sonnet-4-6',
      defaultReasoningEffort: 'xhigh',
      defaultFastMode: true,
      extraArgs: '--search',
    });

    expect(host.querySelector('[data-testid="session-model-editor"]')).not.toBeNull();
  });

  it('keeps model settings reachable when search has no result', async () => {
    await renderEditor(root, queryClient);
    await openModelPicker(host);

    const input = document.querySelector<HTMLInputElement>('[data-slot="combobox-content"] input');
    expect(input).not.toBeNull();
    await act(async () => setInputValue(input!, 'not-configured-model'));
    await settle();

    const content = document.querySelector<HTMLElement>('[data-slot="combobox-content"]');
    expect(content?.textContent).toContain('workspaceRuntime.model.empty');
    const manageButton = Array.from(content?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('workspaceRuntime.model.manage')
    );
    expect(manageButton).not.toBeUndefined();
    await clickUser(manageButton!);
    expect(mocks.manageModels).toHaveBeenCalledOnce();
  });
});

async function renderEditor(root: Root, queryClient: QueryClient) {
  const { SessionModelEditor } = await import(
    '@renderer/lib/components/agent-selector/session-model-editor'
  );
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(SessionModelEditor, {
          runtimeId: 'codex',
          currentModel: 'gpt-5.5',
          currentModelSource: 'agents.runtimeInfo.currentSession',
          reasoningEffort: 'high',
          fastMode: false,
          onRestartWithModel: mocks.restartWithModel,
          onManageModels: mocks.manageModels,
          allowDefaultChange: true,
        })
      )
    )
  );
  await settle();
}

async function openModelPicker(host: HTMLElement) {
  const trigger = host.querySelector<HTMLButtonElement>(
    'button[aria-label="workspaceRuntime.model.choose"]'
  );
  if (!trigger) throw new Error('Model selector is missing');
  await clickUser(trigger);
  await settle();
}

async function chooseReasoningEffort(host: HTMLElement, text: string) {
  const trigger = host.querySelector<HTMLButtonElement>(
    'button[aria-label="workspaceRuntime.model.reasoningLabel"]'
  );
  if (!trigger) throw new Error('Reasoning selector is missing');
  await clickUser(trigger);
  await settle();
  const option = Array.from(
    document.querySelectorAll<HTMLElement>('[data-slot="select-item"]')
  ).find((candidate) => candidate.textContent?.includes(text));
  if (!option) throw new Error(`Reasoning option is missing: ${text}`);
  await clickUser(option);
  await settle();
}

async function clickButtonContaining(host: HTMLElement, text: string) {
  const button = Array.from(host.querySelectorAll('button')).find((item) =>
    item.textContent?.includes(text)
  );
  if (!button) throw new Error(`Button is missing: ${text}`);
  await clickUser(button);
  await settle();
}

async function waitForComboboxItem(text: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const item = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="combobox-item"]')
    ).find((candidate) => candidate.textContent?.includes(text));
    if (item) return item;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    });
  }
  return undefined;
}

async function clickUser(element: Element) {
  await act(async () => {
    await userEvent.click(element);
  });
}

function providerGroup(
  id: string,
  name: string,
  catalogModels: string[]
): ModelProviderCatalogGroup {
  return {
    id,
    name,
    custom: id === 'siliconflow',
    models: catalogModels.map((modelId) => ({
      id: modelId,
      custom: id === 'siliconflow',
      sources: [id === 'siliconflow' ? ('custom' as const) : ('official' as const)],
    })),
    customModels: id === 'siliconflow' ? catalogModels : [],
    officialSourceUrl: null,
    officialSnapshotAt: null,
    officialFetchedAt: null,
    lastUpdateAttemptAt: null,
    officialApiSupported: id !== 'siliconflow',
    officialApiConfigured: false,
    updateStatus: id === 'siliconflow' ? 'customOnly' : 'snapshot',
  };
}

function catalogResult(providers: ModelProviderCatalogGroup[]): ModelProviderCatalogResult {
  return {
    providers,
    fetchedAt: '2026-08-01T00:00:00.000Z',
    automaticUpdatesEnabled: true,
    lastAutomaticRefreshAt: null,
    nextAutomaticRefreshAt: null,
  };
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}
