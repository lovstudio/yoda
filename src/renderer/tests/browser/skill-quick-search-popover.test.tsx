import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogIndex, CatalogSkill } from '@shared/skills/types';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const localSkill: CatalogSkill = {
  key: 'skill:local:calendar:test',
  ref: {
    key: 'skill:local:calendar:test',
    id: 'calendar',
    source: 'local',
    locator: '/tmp/calendar',
  },
  id: 'calendar',
  displayName: 'Calendar',
  description: 'Manage meetings',
  source: 'local',
  scope: 'user',
  managed: false,
  frontmatter: { name: 'calendar', description: 'Manage meetings' },
  installed: true,
  localPath: '/tmp/calendar',
};

const installedExternalSkill: CatalogSkill = {
  ...localSkill,
  key: 'skill:local:remote-search:test',
  ref: {
    key: 'skill:local:remote-search:test',
    id: 'remote-search',
    source: 'local',
    locator: '/tmp/remote-search',
  },
  id: 'remote-search',
  displayName: 'Remote Search',
  localPath: '/Users/test/.agents/skills/remote-search',
};

const catalog: CatalogIndex = {
  version: 4,
  lastUpdated: '2026-07-23T00:00:00.000Z',
  skills: [localSkill],
};

const mocks = vi.hoisted(() => ({
  getCatalog: vi.fn(),
  installClawHub: vi.fn(),
  onInstalled: vi.fn(),
  onManageSkills: vi.fn(),
  searchClawHub: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { query?: string }) =>
      options?.query ? `${key}:${options.query}` : key,
  }),
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  useToast: () => ({
    toast: {
      error: mocks.toastError,
      success: mocks.toastSuccess,
    },
  }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    skills: {
      getCatalog: mocks.getCatalog,
      installClawHub: mocks.installClawHub,
      searchClawHub: mocks.searchClawHub,
    },
  },
}));

vi.mock('@renderer/features/skills/components/SkillIconRenderer', () => ({
  default: () => createElement('span', { 'data-testid': 'skill-icon' }),
}));

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('SkillQuickSearchPopover', () => {
  let host: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCatalog.mockResolvedValue({ success: true, data: catalog });
    mocks.searchClawHub.mockResolvedValue({
      success: true,
      data: [
        {
          source: 'clawhub',
          slug: 'remote-search',
          displayName: 'Remote Search',
          description: 'Find external resources',
          ownerHandle: 'publisher',
          sourceUrl: 'https://clawhub.ai/publisher/skills/remote-search',
        },
      ],
    });
    mocks.installClawHub.mockResolvedValue({ success: true, data: installedExternalSkill });
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
    host.remove();
  });

  it('keeps search local-first, then searches and installs from ClawHub', async () => {
    const { SkillQuickSearchPopover } = await import(
      '@renderer/features/skills/components/SkillQuickSearchPopover'
    );
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(SkillQuickSearchPopover, {
            onInstalled: mocks.onInstalled,
            onManageSkills: mocks.onManageSkills,
          })
        )
      )
    );
    await settle();

    expect(host.textContent).toContain('Calendar');
    expect(mocks.searchClawHub).not.toHaveBeenCalled();

    const manageButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="skills.quickSearch.manageAll"]'
    );
    expect(manageButton).not.toBeNull();
    await act(async () => manageButton?.click());
    expect(mocks.onManageSkills).toHaveBeenCalledOnce();

    const input = host.querySelector<HTMLInputElement>('input');
    expect(input).not.toBeNull();
    await act(async () => setInputValue(input!, 'remote-search'));

    const searchButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('skills.quickSearch.searchExternal')
    );
    expect(searchButton).not.toBeUndefined();
    await act(async () => searchButton?.click());
    await settle();

    expect(mocks.searchClawHub).toHaveBeenCalledWith({ query: 'remote-search', limit: 20 });
    expect(host.textContent).toContain('Remote Search');

    const installButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('skills.quickSearch.install')
    );
    expect(installButton).not.toBeUndefined();
    await act(async () => installButton?.click());
    await settle();

    expect(mocks.installClawHub).toHaveBeenCalledWith({
      slug: 'remote-search',
      ownerHandle: 'publisher',
    });
    expect(mocks.onInstalled).toHaveBeenCalledWith(installedExternalSkill);
  });
});
