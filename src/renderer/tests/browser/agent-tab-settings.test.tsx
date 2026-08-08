import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/features/settings/use-runtime-settings', () => ({
  useRuntimeSettings: () => ({
    value: {
      cli: 'claude',
      statusMonitor: 'activity',
      namingModel: '',
      namingCommand: '',
    },
    defaults: { cli: 'claude', statusMonitor: 'activity' },
    overrides: {},
    isLoading: false,
    isSaving: false,
    update: mocks.update,
  }),
}));

vi.mock('@renderer/features/settings/components/CustomCommandModal', () => ({
  default: () => null,
}));

vi.mock('@renderer/features/settings/components/StatuslineSettingsCard', () => ({
  default: () => null,
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    runtimeSettings: {
      inferNamingModelCandidates: vi.fn().mockResolvedValue({ candidates: [] }),
    },
  },
}));

describe('AgentTabSettings status monitoring', () => {
  let host: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    document.querySelectorAll('[data-slot="select-content"]').forEach((node) => node.remove());
    host.remove();
  });

  it('shows client-specific choices and persists the selected monitor with existing settings', async () => {
    const { AgentTabSettings } = await import(
      '@renderer/features/agents/components/AgentTabSettings'
    );
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(AgentTabSettings, { agentId: 'claude' })
        )
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const trigger = host.querySelector('[aria-label="agents.settings.statusMonitorTitle"]');
    expect(trigger?.textContent).toContain('agents.settings.statusMonitors.activity.label');
    await clickUser(trigger!);
    const transcript = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="select-item"]')
    ).find((item) => item.textContent?.includes('agents.settings.statusMonitors.transcript.label'));
    expect(transcript).not.toBeUndefined();
    await clickUser(transcript!);

    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ cli: 'claude', statusMonitor: 'transcript' })
    );
  });
});

async function clickUser(element: Element): Promise<void> {
  await act(async () => {
    await userEvent.click(element);
  });
}
