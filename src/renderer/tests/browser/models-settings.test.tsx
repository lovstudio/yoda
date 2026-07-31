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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  createProvider: vi.fn(),
  deleteProvider: vi.fn(),
  listProviders: vi.fn(),
  refreshProviders: vi.fn(),
  setAutomaticUpdates: vi.fn(),
  showConfirm: vi.fn(),
  updateCustomModels: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({
    t: (key: string, values?: { count?: number; model?: string; provider?: string }) => {
      if (values?.model) return `${key}:${values.model}`;
      if (values?.provider) return `${key}:${values.provider}:${values.count ?? ''}`;
      return key;
    },
  }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    llm: {
      createCustomModelProvider: mocks.createProvider,
      deleteCustomModelProvider: mocks.deleteProvider,
      listModelProviders: mocks.listProviders,
      refreshModelProviders: mocks.refreshProviders,
      setModelProviderAutomaticUpdates: mocks.setAutomaticUpdates,
      updateModelProviderCustomModels: mocks.updateCustomModels,
    },
    app: {
      openExternal: vi.fn(),
    },
  },
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  useShowModal: () => mocks.showConfirm,
}));

describe('Models settings', () => {
  let host: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let result: ModelProviderCatalogResult;

  beforeEach(() => {
    vi.clearAllMocks();
    result = catalogResult([
      providerGroup('openai', 'OpenAI', ['openai/gpt-5.5']),
      providerGroup('anthropic', 'Anthropic', ['anthropic/claude-sonnet-4.6']),
      providerGroup('kimi', 'Kimi', ['moonshotai/kimi-k2.5']),
    ]);
    mocks.listProviders.mockImplementation(async () => result);
    mocks.refreshProviders.mockImplementation(async () => result);
    mocks.setAutomaticUpdates.mockImplementation(async (enabled: boolean) => {
      result = { ...result, automaticUpdatesEnabled: enabled };
      return result;
    });
    mocks.createProvider.mockImplementation(
      async (input: { id: string; name: string; initialModel?: string }) => {
        const modelId = input.initialModel ? `${input.id}/${input.initialModel}` : null;
        result = {
          ...result,
          providers: [
            ...result.providers,
            {
              id: input.id,
              name: input.name,
              custom: true,
              models: modelId ? [{ id: modelId, custom: true, sources: ['custom' as const] }] : [],
              customModels: modelId ? [modelId] : [],
              officialSourceUrl: null,
              officialSnapshotAt: null,
              officialFetchedAt: null,
              lastUpdateAttemptAt: null,
              officialApiSupported: false,
              officialApiConfigured: false,
              updateStatus: 'customOnly',
            },
          ],
        };
        return result;
      }
    );
    mocks.deleteProvider.mockImplementation(async (providerId: string) => {
      result = {
        ...result,
        providers: result.providers.filter((provider) => provider.id !== providerId),
      };
      return result;
    });
    mocks.updateCustomModels.mockImplementation(
      async (providerId: string, customModels: string[]) => {
        result = {
          ...result,
          providers: result.providers.map((provider) => {
            if (provider.id !== providerId) return provider;
            const catalogModels = provider.models.filter((model) => !model.custom);
            return {
              ...provider,
              customModels,
              models: [
                ...customModels.map((id) => ({
                  id,
                  custom: true,
                  sources: ['custom' as const],
                })),
                ...catalogModels,
              ],
            };
          }),
        };
        return result;
      }
    );
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    host = document.createElement('div');
    host.style.width = '440px';
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    document.querySelectorAll('[data-slot="select-content"]').forEach((node) => node.remove());
    host.remove();
  });

  it('adds and removes an OpenAI model without treating Codex as a provider', async () => {
    await renderModelsSettings(root, queryClient);

    expect(host.textContent).toContain('OpenAI');
    expect(host.textContent).not.toContain('Codex');

    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="settings.models.customInput"]'
    );
    expect(input).not.toBeNull();

    await act(async () => setInputValue(input!, 'gpt-5.6-codex'));
    await clickButtonContaining(host, 'settings.models.customAdd');
    await flush();

    expect(mocks.updateCustomModels).toHaveBeenCalledWith('openai', ['openai/gpt-5.6-codex']);
    expect(host.textContent).toContain('openai/gpt-5.6-codex');
    expect(host.textContent).toContain('settings.models.customBadge');

    const removeButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="settings.models.removeCustom:openai/gpt-5.6-codex"]'
    );
    await act(async () => removeButton?.click());
    await flush();

    expect(mocks.updateCustomModels).toHaveBeenLastCalledWith('openai', []);
    const card = host.querySelector<HTMLElement>('[data-testid="models-settings-card"]');
    expect(card).not.toBeNull();
    const cardRight = card!.getBoundingClientRect().right;
    const overflowingElements = Array.from(card!.querySelectorAll<HTMLElement>('*'))
      .filter((element) => element.getBoundingClientRect().right > cardRight + 1)
      .map((element) => ({
        slot: element.dataset.slot,
        tag: element.tagName,
        text: element.textContent?.slice(0, 80),
        width: element.getBoundingClientRect().width,
      }));
    expect(overflowingElements).toEqual([]);
  });

  it('switches between Anthropic and Kimi vendor catalogs independently', async () => {
    await renderModelsSettings(root, queryClient);

    await selectProvider(host, 'Anthropic');
    expect(host.textContent).toContain('anthropic/claude-sonnet-4.6');
    expect(host.textContent).not.toContain('moonshotai/kimi-k2.5');

    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="settings.models.customInput"]'
    );
    await act(async () => setInputValue(input!, 'claude-opus-4.7'));
    await clickButtonContaining(host, 'settings.models.customAdd');
    await flush();

    expect(mocks.updateCustomModels).toHaveBeenLastCalledWith('anthropic', [
      'anthropic/claude-opus-4.7',
    ]);

    await selectProvider(host, 'Kimi');
    expect(host.textContent).toContain('moonshotai/kimi-k2.5');
    expect(host.textContent).not.toContain('anthropic/claude-opus-4.7');
  });

  it('checks the selected vendor and exposes automatic updates as a global setting', async () => {
    await renderModelsSettings(root, queryClient);

    expect(host.textContent).toContain('settings.models.updateStatus.snapshot');
    expect(host.textContent).toContain('settings.models.officialBadge');
    const catalogActions = host.querySelector<HTMLElement>('[data-testid="model-catalog-actions"]');
    const catalogStatus = host.querySelector<HTMLElement>('[data-testid="model-catalog-status"]');
    expect(catalogActions).not.toBeNull();
    expect(catalogActions?.contains(catalogStatus)).toBe(true);
    expect(catalogStatus?.title).toContain('settings.models.officialSnapshotNeedsKey');
    expect(catalogActions?.textContent).toContain('settings.models.customAdd');
    expect(catalogActions?.textContent).toContain('settings.models.refresh');

    await clickButtonContaining(host, 'settings.models.refresh');
    await flush();
    expect(mocks.refreshProviders).toHaveBeenCalledWith('openai');

    const automaticUpdate = host.querySelector<HTMLElement>(
      '[role="switch"][aria-label="settings.models.automaticUpdates"]'
    );
    const automaticUpdateSetting = host.querySelector<HTMLElement>(
      '[data-testid="model-catalog-auto-update-setting"]'
    );
    const catalogCard = host.querySelector<HTMLElement>('[data-testid="models-settings-card"]');
    expect(automaticUpdate).not.toBeNull();
    expect(automaticUpdateSetting?.textContent).toContain('settings.models.automaticUpdates');
    expect(catalogCard?.contains(automaticUpdateSetting)).toBe(false);
    await act(async () => automaticUpdate?.click());
    await flush();
    expect(mocks.setAutomaticUpdates).toHaveBeenCalledWith(false);
  });

  it('creates a custom provider with an initial model and deletes it after confirmation', async () => {
    await renderModelsSettings(root, queryClient);

    await selectProvider(host, 'settings.models.addProvider');
    const nameInput = host.querySelector<HTMLInputElement>(
      'input[aria-label="settings.models.providerName"]'
    );
    const idInput = host.querySelector<HTMLInputElement>(
      'input[aria-label="settings.models.providerId"]'
    );
    const modelInput = host.querySelector<HTMLInputElement>(
      'input[aria-label="settings.models.providerInitialModel"]'
    );
    expect(nameInput).not.toBeNull();
    expect(idInput).not.toBeNull();
    expect(modelInput).not.toBeNull();

    await act(async () => setInputValue(nameInput!, 'SiliconFlow'));
    await act(async () => setInputValue(idInput!, 'siliconflow'));
    await act(async () => setInputValue(modelInput!, 'deepseek-v3.2'));
    await clickButtonContaining(host, 'settings.models.createProvider');
    await flush();

    expect(mocks.createProvider).toHaveBeenCalledWith({
      id: 'siliconflow',
      name: 'SiliconFlow',
      initialModel: 'deepseek-v3.2',
    });
    expect(host.textContent).toContain('SiliconFlow');
    expect(host.textContent).toContain('siliconflow/deepseek-v3.2');
    expect(host.textContent).toContain('settings.models.updateStatus.customOnly');
    expect(host.textContent).not.toContain('settings.models.refresh');

    await clickButtonContaining(host, 'settings.models.deleteProvider');
    expect(mocks.showConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'settings.models.deleteProviderTitle',
        description: 'settings.models.deleteProviderDescription:SiliconFlow:',
        confirmLabel: 'settings.models.deleteProviderConfirm',
      })
    );
    const confirmArgs = mocks.showConfirm.mock.calls.at(-1)?.[0] as
      | { onSuccess: () => void }
      | undefined;
    await act(async () => confirmArgs?.onSuccess());
    await flush();

    expect(mocks.deleteProvider).toHaveBeenCalledWith('siliconflow');
    expect(host.textContent).not.toContain('siliconflow/deepseek-v3.2');
  });
});

async function renderModelsSettings(root: Root, queryClient: QueryClient) {
  const { default: ModelsSettingsCard, ModelCatalogAutomaticUpdateSetting } = await import(
    '@renderer/features/settings/components/ModelsSettingsCard'
  );
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          'div',
          null,
          createElement(ModelCatalogAutomaticUpdateSetting),
          createElement(ModelsSettingsCard)
        )
      )
    )
  );
  await flush();
}

async function selectProvider(host: HTMLElement, name: string) {
  const trigger = host.querySelector<HTMLButtonElement>(
    'button[aria-label="settings.models.provider"]'
  );
  if (!trigger) throw new Error('Provider selector is missing');
  await userEvent.click(trigger);
  await flush();

  const option = Array.from(
    document.querySelectorAll<HTMLElement>('[data-slot="select-item"]')
  ).find((item) => item.textContent?.includes(name));
  if (!option) throw new Error(`${name} provider option is missing`);
  await userEvent.click(option);
  await flush();
}

async function clickButtonContaining(host: HTMLElement, text: string) {
  const button = Array.from(host.querySelectorAll('button')).find((item) =>
    item.textContent?.includes(text)
  );
  await act(async () => button?.click());
}

function providerGroup(
  id: string,
  name: string,
  catalogModels: string[]
): ModelProviderCatalogGroup {
  return {
    id,
    name,
    custom: false,
    models: catalogModels.map((modelId) => ({
      id: modelId,
      custom: false,
      sources: ['official'],
    })),
    customModels: [],
    officialSourceUrl: `https://example.com/${id}`,
    officialSnapshotAt: '2026-07-31T00:00:00.000Z',
    officialFetchedAt: null,
    lastUpdateAttemptAt: null,
    officialApiSupported: true,
    officialApiConfigured: false,
    updateStatus: 'snapshot',
  };
}

function catalogResult(providers: ModelProviderCatalogGroup[]): ModelProviderCatalogResult {
  return {
    providers,
    fetchedAt: '2026-07-31T00:00:00.000Z',
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

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
