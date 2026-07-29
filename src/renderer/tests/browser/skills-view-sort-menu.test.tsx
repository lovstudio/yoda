import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogSkill } from '@shared/skills/types';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  setSearchQuery: vi.fn(),
  refresh: vi.fn(),
  install: vi.fn(),
  setDisabledBatch: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/lib/layout/navigation-provider', () => ({
  useOpenViewTab: () => ({ openViewTab: vi.fn() }),
  useParams: () => ({ params: {}, setParams: vi.fn() }),
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  useShowModal: () => vi.fn(),
}));

vi.mock('@renderer/features/skills/components/ExternalSkillMarketplaces', () => ({
  default: () => null,
}));

vi.mock('@renderer/features/skills/components/SkillsCatalogHint', () => ({
  default: () => null,
}));

vi.mock('@renderer/features/skills/components/SkillAccordionRow', () => ({
  default: () => null,
}));

vi.mock('@renderer/features/skills/components/SkillsTreeSection', () => ({
  default: () => null,
}));

const installedSkill: CatalogSkill = {
  key: 'skill:local:frontend-design:/skills/frontend-design',
  ref: {
    key: 'skill:local:frontend-design:/skills/frontend-design',
    id: 'frontend-design',
    source: 'local',
    locator: '/skills/frontend-design',
  },
  id: 'frontend-design',
  displayName: 'Frontend Design',
  description: 'Design interfaces',
  source: 'local',
  scope: 'user',
  managed: false,
  frontmatter: { name: 'frontend-design', description: 'Design interfaces' },
  installed: true,
  localPath: '/skills/frontend-design',
};

vi.mock('@renderer/features/skills/components/useSkills', () => ({
  useSkills: () => ({
    catalog: { version: 4, lastUpdated: new Date(0).toISOString(), skills: [installedSkill] },
    isLoading: false,
    isRefreshing: false,
    searchQuery: '',
    setSearchQuery: mocks.setSearchQuery,
    installedSkills: [installedSkill],
    recommendedSkills: [],
    refresh: mocks.refresh,
    install: mocks.install,
    setDisabledBatch: mocks.setDisabledBatch,
  }),
}));

vi.mock('@renderer/features/skills/components/useSkillUsage', () => ({
  useSkillUsage: () => ({
    usage: null,
    isRefreshing: false,
    refresh: vi.fn(),
    lookupUsage: () => undefined,
  }),
}));

describe('SkillsView sort menu', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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

  it('keeps the root menu compact and moves detailed sort modes into submenus', async () => {
    const { default: SkillsView } = await import('@renderer/features/skills/components/SkillsView');
    await act(async () => root.render(createElement(SkillsView, { embedded: true })));

    const trigger = host.querySelector<HTMLButtonElement>(
      'button[aria-label="skills.sort.ariaLabel"]'
    );
    await act(async () => trigger?.click());

    const menu = document.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"]');
    expect(menu?.textContent).toContain('skills.sort.name');
    expect(menu?.textContent).toContain('skills.sort.usageGroup');
    expect(menu?.textContent).toContain('skills.sort.contentGroup');
    expect(menu?.textContent).not.toContain('skills.sort.total');
  });
});
