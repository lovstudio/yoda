import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { AgentModelCandidateInferenceResult } from '@shared/runtime-model-candidates';
import type { RuntimeId } from '@shared/runtime-registry';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  inferModels: vi.fn(),
  updateModels: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({
    t: (key: string, values?: { count?: number; model?: string }) =>
      values?.model ? `${key}:${values.model}` : key,
  }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    runtimeSettings: {
      inferNamingModelCandidates: mocks.inferModels,
      updateModelCandidatePreferences: mocks.updateModels,
    },
  },
}));

describe('Models settings', () => {
  let host: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let results: Record<RuntimeId, AgentModelCandidateInferenceResult>;

  beforeEach(() => {
    vi.clearAllMocks();
    results = {
      claude: modelResult('claude', ['claude-sonnet-4-6']),
      codex: modelResult('codex', ['gpt-5.5']),
    } as Record<RuntimeId, AgentModelCandidateInferenceResult>;
    mocks.inferModels.mockImplementation(async (runtimeId: RuntimeId) => results[runtimeId]);
    mocks.updateModels.mockImplementation(
      async (runtimeId: RuntimeId, input: { customModels?: string[] }) => {
        const current = results[runtimeId];
        const customModels = input.customModels ?? current.customModels;
        const discovered = current.models.filter((model) => !model.sources.includes('custom'));
        const custom = customModels.map((id) => ({
          id,
          visible: true,
          sources: ['custom' as const],
        }));
        results[runtimeId] = {
          ...current,
          customModels,
          models: [...custom, ...discovered],
          candidates: [...custom.map((model) => model.id), ...discovered.map((model) => model.id)],
        };
        return results[runtimeId];
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

  it('adds and removes a custom model for the selected provider without horizontal overflow', async () => {
    const { default: ModelsSettingsCard } = await import(
      '@renderer/features/settings/components/ModelsSettingsCard'
    );
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(ModelsSettingsCard)
        )
      )
    );
    await flush();

    expect(host.textContent).toContain('Claude Code');
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="agents.models.customInput"]'
    );
    expect(input).not.toBeNull();

    await act(async () => {
      setInputValue(input!, 'anthropic/claude-opus-4-7');
    });
    const addButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('agents.models.customAdd')
    );
    await act(async () => addButton?.click());
    await flush();

    expect(mocks.updateModels).toHaveBeenCalledWith('claude', {
      customModels: ['anthropic/claude-opus-4-7'],
    });
    expect(host.textContent).toContain('anthropic/claude-opus-4-7');
    expect(host.textContent).toContain('agents.models.customBadge');

    const removeButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="agents.models.removeCustom:anthropic/claude-opus-4-7"]'
    );
    await act(async () => removeButton?.click());
    await flush();

    expect(mocks.updateModels).toHaveBeenLastCalledWith('claude', { customModels: [] });
    const card = host.querySelector<HTMLElement>('[data-testid="models-settings-card"]');
    expect(card).not.toBeNull();
    expect(card!.scrollWidth).toBeLessThanOrEqual(card!.clientWidth);
  });

  it('switches provider before editing its independent model list', async () => {
    const { default: ModelsSettingsCard } = await import(
      '@renderer/features/settings/components/ModelsSettingsCard'
    );
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(ModelsSettingsCard)
        )
      )
    );
    await flush();

    const providerTrigger = host.querySelector<HTMLButtonElement>(
      'button[aria-label="settings.models.provider"]'
    );
    if (!providerTrigger) throw new Error('Provider selector is missing');
    await userEvent.click(providerTrigger);
    await flush();
    const codexItem = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="select-item"]')
    ).find((item) => item.textContent?.includes('Codex'));
    if (!codexItem) throw new Error('Codex provider option is missing');
    await userEvent.click(codexItem);
    await flush();

    expect(host.textContent).toContain('gpt-5.5');
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="agents.models.customInput"]'
    );
    await act(async () => setInputValue(input!, 'openai/gpt-5.6-codex'));
    const addButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('agents.models.customAdd')
    );
    await act(async () => addButton?.click());
    await flush();

    expect(mocks.updateModels).toHaveBeenLastCalledWith('codex', {
      customModels: ['openai/gpt-5.6-codex'],
    });
  });
});

function modelResult(
  runtimeId: RuntimeId,
  discoveredModels: string[]
): AgentModelCandidateInferenceResult {
  return {
    runtimeId,
    models: discoveredModels.map((id) => ({
      id,
      visible: true,
      sources: ['catalog'],
    })),
    candidates: discoveredModels,
    sources: [
      {
        source: 'catalog',
        models: discoveredModels,
        fetchedAt: '2026-07-31T00:00:00.000Z',
        expiresAt: '2099-07-31T00:00:00.000Z',
      },
    ],
    hiddenModels: [],
    customModels: [],
    cached: true,
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
