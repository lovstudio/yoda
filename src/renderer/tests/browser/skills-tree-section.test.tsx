import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogSkill } from '@shared/skills/types';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({
    t: (key: string, options?: { name?: string; count?: number }) =>
      `${key}:${options?.name ?? ''}:${options?.count ?? ''}`,
  }),
}));

function skill(id: string, scope: CatalogSkill['scope'] = 'user'): CatalogSkill {
  const key = `skill:local:${id}:/skills/${id}`;
  return {
    key,
    ref: { key, id, source: 'local', locator: `/skills/${id}` },
    id,
    displayName: id,
    description: `${id} description`,
    source: 'local',
    scope,
    managed: false,
    frontmatter: { name: id, description: `${id} description` },
    installed: true,
    disabled: false,
    localPath: `/skills/${id}`,
  };
}

describe('SkillsTreeSection', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.querySelectorAll('[data-slot="tooltip-content"]').forEach((node) => node.remove());
    host.remove();
  });

  it('disables an editable prefix group with one batch action and excludes plugin skills', async () => {
    const { default: SkillsTreeSection } = await import(
      '@renderer/features/skills/components/SkillsTreeSection'
    );
    const skills = [
      skill('lovstudio-alpha'),
      skill('lovstudio-beta'),
      skill('lovstudio-plugin', 'plugin'),
    ];
    const onSetDisabledBatch = vi.fn().mockResolvedValue(true);

    await act(async () =>
      root.render(
        createElement(SkillsTreeSection, {
          skills,
          orderBy: 'position',
          lookupUsage: () => undefined,
          familiesByPrimaryKey: new Map(),
          onSelect: vi.fn(),
          onInstall: vi.fn(),
          onSetDisabledBatch,
          setSkillRef: () => () => undefined,
          highlightedSkillId: null,
        })
      )
    );

    const action = host.querySelector<HTMLButtonElement>(
      'button[aria-label^="skills.groupDisableAria"]'
    );
    expect(action?.getAttribute('aria-label')).toBe('skills.groupDisableAria:lovstudio:2');

    await act(async () => action?.click());

    expect(onSetDisabledBatch).toHaveBeenCalledTimes(1);
    expect(onSetDisabledBatch).toHaveBeenCalledWith([skills[0].key, skills[1].key], true);
  });
});
