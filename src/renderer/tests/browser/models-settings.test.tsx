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
  listProviders: vi.fn(),
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
      listModelProviders: mocks.listProviders,
      updateModelProviderCustomModels: mocks.updateCustomModels,
    },
  },
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
              models: [...customModels.map((id) => ({ id, custom: true })), ...catalogModels],
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
    expect(card!.scrollWidth).toBeLessThanOrEqual(card!.clientWidth);
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
});

async function renderModelsSettings(root: Root, queryClient: QueryClient) {
  const { default: ModelsSettingsCard } = await import(
    '@renderer/features/settings/components/ModelsSettingsCard'
  );
  await act(async () =>
    root.render(
      createElement(QueryClientProvider, { client: queryClient }, createElement(ModelsSettingsCard))
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
    models: catalogModels.map((modelId) => ({ id: modelId, custom: false })),
    customModels: [],
  };
}

function catalogResult(providers: ModelProviderCatalogGroup[]): ModelProviderCatalogResult {
  return {
    providers,
    fetchedAt: '2026-07-31T00:00:00.000Z',
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
