import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn(async () => {}),
  setLanguage: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/lib/i18n/use-app-language', () => ({
  useAppLanguage: () => ({ currentLanguage: 'zh-CN', setLanguage: mocks.setLanguage }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: { app: { openExternal: mocks.openExternal } },
}));

describe('ExternalSkillMarketplaces', () => {
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
    document
      .querySelectorAll('[data-slot="dropdown-menu-content"]')
      .forEach((node) => node.remove());
    host.remove();
  });

  it('prioritizes ClawHub and keeps every marketplace plus language in the quick menu', async () => {
    const { default: ExternalSkillMarketplaces } = await import(
      '@renderer/features/skills/components/ExternalSkillMarketplaces'
    );
    await act(async () => root.render(createElement(ExternalSkillMarketplaces)));

    const clawHubButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('ClawHub')
    );
    expect(clawHubButton).toBeDefined();
    await act(async () => clawHubButton?.click());
    expect(mocks.openExternal).toHaveBeenCalledWith('https://clawhub.ai/skills');

    const menuTrigger = host.querySelector<HTMLButtonElement>(
      'button[aria-label="skills.marketplaces.menuAria"]'
    );
    await act(async () => menuTrigger?.click());

    for (const marketplace of [
      'ClawHub',
      'Skills.sh',
      'SkillsMP',
      'AgentSkill.sh',
      'GitHub Topics',
    ]) {
      expect(document.body.textContent).toContain(marketplace);
    }
    expect(document.body.textContent).toContain('language.zh-CN');
    expect(document.body.textContent).toContain('language.en');

    const englishItem = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')
    ).find((item) => item.textContent?.includes('language.en'));
    await act(async () => englishItem?.click());
    expect(mocks.setLanguage).toHaveBeenCalledWith('en');
  });
});
