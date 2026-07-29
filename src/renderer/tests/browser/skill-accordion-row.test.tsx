import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogSkill } from '@shared/skills/types';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  onInstall: vi.fn(),
  onSelect: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({
    t: (key: string, options?: { name?: string; defaultValue?: string }) =>
      options?.name ? `${key}:${options.name}` : (options?.defaultValue ?? key),
  }),
}));

vi.mock('@renderer/features/skills/components/SkillIconRenderer', () => ({
  default: () => createElement('span', { 'data-testid': 'skill-icon' }),
}));

vi.mock('@renderer/lib/components/file-path-actions', () => ({
  GlobalFileMenuItems: () => null,
}));

function skill(installed: boolean): CatalogSkill {
  return {
    key: 'skill:local:frontend-design:test',
    ref: {
      key: 'skill:local:frontend-design:test',
      id: 'frontend-design',
      source: 'local',
      locator: '/skills/frontend-design',
    },
    id: 'frontend-design',
    displayName: 'Frontend Design',
    description: 'Design polished product interfaces',
    source: 'local',
    scope: 'user',
    managed: false,
    frontmatter: {
      name: 'frontend-design',
      description: 'Design polished product interfaces',
    },
    installed,
  };
}

describe('SkillAccordionRow', () => {
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
    document.querySelectorAll('[data-slot="tooltip-content"]').forEach((node) => node.remove());
    host.remove();
  });

  it('expands inline while keeping the installed skill detail action separate', async () => {
    const { default: SkillAccordionRow } = await import(
      '@renderer/features/skills/components/SkillAccordionRow'
    );
    await act(async () =>
      root.render(
        createElement(SkillAccordionRow, {
          skill: skill(true),
          onSelect: mocks.onSelect,
          onInstall: mocks.onInstall,
        })
      )
    );

    const trigger = host.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('[data-testid="skill-icon"]')).toBeNull();

    await act(async () => trigger?.click());

    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[data-slot="collapsible-content"]')?.textContent).toContain(
      'Design polished product interfaces'
    );

    const detailAction = host.querySelector<HTMLButtonElement>(
      'button[aria-label="skills.openDetailsAria:Frontend Design"]'
    );
    await act(async () => detailAction?.click());
    expect(mocks.onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'frontend-design' }));
    expect(mocks.onInstall).not.toHaveBeenCalled();
  });

  it('keeps installation outside the accordion trigger', async () => {
    const { default: SkillAccordionRow } = await import(
      '@renderer/features/skills/components/SkillAccordionRow'
    );
    await act(async () =>
      root.render(
        createElement(SkillAccordionRow, {
          skill: skill(false),
          onSelect: mocks.onSelect,
          onInstall: mocks.onInstall,
        })
      )
    );

    const installAction = host.querySelector<HTMLButtonElement>(
      'button[aria-label="skills.installAria:Frontend Design"]'
    );
    await act(async () => installAction?.click());

    expect(mocks.onInstall).toHaveBeenCalledWith('skill:local:frontend-design:test');
    expect(mocks.onSelect).not.toHaveBeenCalled();
    expect(
      host
        .querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')
        ?.getAttribute('aria-expanded')
    ).toBe('false');
  });
});
