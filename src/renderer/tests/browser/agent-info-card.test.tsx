import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn(),
  pinView: vi.fn(),
  refetch: vi.fn(),
  refreshAgents: vi.fn(),
  runRuntimeAction: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({
    t: (key: string, values?: { version?: string }) =>
      values?.version ? `${key}:${values.version}` : key,
  }),
}));

vi.mock('@renderer/lib/components/agent-logo', () => ({
  default: () => <span data-testid="agent-logo" />,
}));

vi.mock('@renderer/lib/components/file-path-actions', async () => {
  const { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } = await import(
    '@renderer/lib/ui/dropdown-menu'
  );
  return {
    FilePathActionsDropdown: ({ children }: { children?: ReactNode }) => (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button aria-label="fileActions.label" type="button" style={{ height: 20, width: 20 }}>
              …
            </button>
          }
        />
        <DropdownMenuContent>{children}</DropdownMenuContent>
      </DropdownMenu>
    ),
  };
});

vi.mock('@renderer/lib/components/agent-selector/use-runtime-snapshot', () => ({
  useRuntimeSnapshot: () => ({
    data: {
      installation: {
        status: 'available',
        version: '0.146.0',
        path: '/opt/homebrew/bin/codex',
      },
      model: {
        defaultModel: 'gpt-5.6-terra',
        nativeModel: null,
      },
      config: {
        path: '/Users/test/.codex/config.toml',
        exists: true,
        authProvider: null,
      },
      update: {
        available: true,
        command: 'npm update -g @openai/codex',
        latestVersion: '0.147.0',
      },
    },
    isFetching: false,
    isLoading: false,
    refetch: mocks.refetch,
  }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn(() => vi.fn()),
  },
  rpc: {
    app: {
      clipboardWriteText: vi.fn(),
      openExternal: mocks.openExternal,
    },
  },
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    dependencies: { refreshAgents: mocks.refreshAgents },
    sidePane: { pinView: mocks.pinView },
  },
}));

vi.mock('@renderer/lib/stores/workspace-terminal-store', () => ({
  workspaceTerminalStore: { runRuntimeAction: mocks.runRuntimeAction },
}));

describe('AgentInfoCard', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.openExternal.mockResolvedValue(undefined);
    mocks.refetch.mockResolvedValue(undefined);
    mocks.refreshAgents.mockResolvedValue(undefined);
    mocks.runRuntimeAction.mockResolvedValue(undefined);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document
      .querySelectorAll('[data-slot="dropdown-menu-content"]')
      .forEach((node) => node.remove());
    host.remove();
  });

  it('keeps low-frequency actions in the header and opens the CLI from the executable menu', async () => {
    const { AgentInfoCard } = await import(
      '@renderer/lib/components/agent-selector/agent-info-card'
    );
    await act(async () => root.render(<AgentInfoCard id="codex" />));

    expect(host.querySelector('[data-testid="agent-info-actions-menu"]')).not.toBeNull();
    expect(host.textContent).not.toContain('agents.runtimeInfo.actions');
    expect(host.textContent).not.toContain('agents.runtimeInfo.openCli');
    expect(host.textContent).not.toContain('agents.runtimeInfo.latestVersionLabel');
    expect(host.textContent).not.toContain('agents.runtimeInfo.configDetected');

    const versionMenu = host.querySelector<HTMLButtonElement>(
      '[data-testid="runtime-version-menu"]'
    );
    await clickUser(versionMenu!);
    const versionMenuContent = document.querySelector<HTMLElement>(
      '[data-slot="dropdown-menu-content"]'
    );
    expect(versionMenuContent?.textContent).toContain('agents.runtimeInfo.latestVersionLabel');
    expect(versionMenuContent?.textContent).toContain('v0.147.0');
    expect(versionMenuContent?.textContent).toContain('agents.runtimeInfo.currentVersionLabel');
    expect(versionMenuContent?.textContent).toContain('v0.146.0');
    await clickUser(findMenuItem('agents.runtimeInfo.versionHistory')!);
    expect(mocks.openExternal).toHaveBeenCalledWith('https://github.com/openai/codex/releases');

    const pathMenus = host.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="fileActions.label"]'
    );
    expect(pathMenus).toHaveLength(2);
    await clickUser(pathMenus[0]!);

    const openCli = findMenuItem('agents.runtimeInfo.openCli');
    expect(openCli).not.toBeUndefined();
    await clickUser(openCli!);
    expect(mocks.runRuntimeAction).toHaveBeenCalledWith('codex', 'open');

    const headerMenu = host.querySelector<HTMLButtonElement>(
      '[data-testid="agent-info-actions-menu"]'
    );
    await clickUser(headerMenu!);
    expect(findMenuItem('agents.runtimeInfo.update')).not.toBeUndefined();
    expect(findMenuItem('agents.runtimeInfo.doctor')).not.toBeUndefined();
    expect(findMenuItem('agents.runtimeInfo.manage')).not.toBeUndefined();
    expect(findMenuItem('agents.docs')).not.toBeUndefined();
    expect(findMenuItem('agents.runtimeInfo.refresh')).not.toBeUndefined();

    await clickUser(findMenuItem('agents.runtimeInfo.update')!);
    expect(mocks.runRuntimeAction).toHaveBeenCalledWith('codex', 'update');
  });

  it('uses the active model-access Profile as the authentication identity', async () => {
    const { AgentInfoCard } = await import(
      '@renderer/lib/components/agent-selector/agent-info-card'
    );
    await act(async () =>
      root.render(
        <AgentInfoCard
          id="codex"
          authPresentation={{
            value: 'ZenMux Production',
            detail: 'workspaceRuntime.maas.authenticationSource',
          }}
        />
      )
    );

    expect(host.textContent).toContain('agents.runtimeInfo.auth');
    expect(host.textContent).toContain('ZenMux Production');
    expect(host.textContent).toContain('workspaceRuntime.maas.authenticationSource');
  });
});

function findMenuItem(text: string) {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]')
  ).find((item) => item.textContent?.includes(text));
}

async function clickUser(element: Element) {
  await act(async () => {
    await userEvent.click(element);
  });
}
