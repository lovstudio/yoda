import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn(async () => undefined),
  copyText: vi.fn(async () => undefined),
  toast: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: { app: { openExternal: mocks.openExternal } },
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  copyTextToClipboard: mocks.copyText,
  useToast: () => ({ toast: mocks.toast }),
}));

describe('Notion setup form', () => {
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
    host.remove();
  });

  async function renderForm(error?: string) {
    const { NotionSetupForm, NOTION_INTERNAL_CONNECTION_GUIDE_URL, NOTION_PERSONAL_TOKEN_URL } =
      await import('@renderer/features/integrations/NotionSetupForm');

    function Harness() {
      const [token, setToken] = useState('');
      return createElement(NotionSetupForm, { token, onChange: setToken, error });
    }

    await act(async () => root.render(createElement(Harness)));
    return { NOTION_INTERNAL_CONNECTION_GUIDE_URL, NOTION_PERSONAL_TOKEN_URL };
  }

  it('leads with a personal access token and opens the official token page', async () => {
    const { NOTION_PERSONAL_TOKEN_URL } = await renderForm();

    expect(host.textContent).toContain('integrations.setup.notion.personalTokenTitle');
    expect(host.textContent).toContain('integrations.setup.notion.recommended');

    const openButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('integrations.setup.notion.openTokenPage')
    );
    expect(openButton).toBeDefined();
    await act(async () => openButton?.click());
    expect(mocks.openExternal).toHaveBeenCalledWith(NOTION_PERSONAL_TOKEN_URL);
  });

  it('accepts a token, keeps it masked by default, and exposes an explicit visibility toggle', async () => {
    await renderForm();
    const tokenInput = host.querySelector<HTMLInputElement>('#notion-access-token');
    expect(tokenInput?.type).toBe('password');

    await act(async () => userEvent.fill(tokenInput!, 'ntn_example'));
    expect(tokenInput?.value).toBe('ntn_example');

    const visibilityButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('integrations.setup.notion.showToken')
    );
    await act(async () => visibilityButton?.click());
    expect(tokenInput?.type).toBe('text');
    expect(host.textContent).toContain('integrations.setup.notion.hideToken');
  });

  it('keeps internal connections available as a secondary path', async () => {
    const { NOTION_INTERNAL_CONNECTION_GUIDE_URL } = await renderForm();
    const details = host.querySelector('details');
    expect(details?.open).toBe(false);

    await act(async () => details?.querySelector('summary')?.click());
    expect(details?.open).toBe(true);

    const guideButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('integrations.setup.notion.openInternalGuide')
    );
    await act(async () => guideButton?.click());
    expect(mocks.openExternal).toHaveBeenCalledWith(NOTION_INTERNAL_CONNECTION_GUIDE_URL);
  });

  it('localizes connection errors and copies the raw diagnostic details', async () => {
    await renderForm('Notion authentication failed. Check your integration token.');

    expect(host.textContent).toContain('integrations.setup.notion.errors.invalidToken');
    expect(host.textContent).not.toContain('Notion authentication failed');

    const copyButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('integrations.setup.notion.copyError')
    );
    await act(async () => copyButton?.click());
    expect(mocks.copyText).toHaveBeenCalledWith(
      expect.stringContaining('Error: Notion authentication failed. Check your integration token.')
    );
    expect(host.textContent).toContain('common.copied');
  });

  it('does not overflow its narrow modal container', async () => {
    await renderForm();
    const form = host.querySelector<HTMLElement>('[data-testid="notion-setup-form"]');
    expect(form).not.toBeNull();

    const right = form!.getBoundingClientRect().right;
    const overflowing = Array.from(form!.querySelectorAll<HTMLElement>('*'))
      .filter((element) => element.getBoundingClientRect().right > right + 1)
      .map((element) => element.textContent?.slice(0, 60));
    expect(overflowing).toEqual([]);
  });
});
