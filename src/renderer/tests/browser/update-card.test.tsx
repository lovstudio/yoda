import {
  act,
  createElement,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  check: vi.fn(async () => {}),
  openReleasePage: vi.fn(async () => {}),
  update: {
    currentVersion: '0.16.1',
    progressLabel: '',
    state: { status: 'idle' as const },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    update: {
      ...mocks.update,
      check: mocks.check,
      openReleasePage: mocks.openReleasePage,
    },
  },
}));

vi.mock('@renderer/lib/ui/badge', async () => {
  const { createElement: create } = await import('react');
  return {
    Badge: ({
      children,
      variant: _variant,
      ...props
    }: HTMLAttributes<HTMLSpanElement> & { variant?: string }) => create('span', props, children),
  };
});

vi.mock('@renderer/lib/ui/button', async () => {
  const { createElement: create } = await import('react');
  return {
    Button: ({
      children,
      variant: _variant,
      size: _size,
      ...props
    }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) =>
      create('button', props, children),
  };
});

vi.mock('@renderer/features/settings/components/SettingRow', async () => {
  const { createElement: create } = await import('react');
  return {
    SettingRow: ({
      title,
      description,
      control,
    }: {
      title: ReactNode;
      description?: ReactNode;
      control: ReactNode;
    }) => create('div', null, title, description, control),
  };
});

vi.mock('@renderer/features/settings/components/UpdateProxyRow', () => ({
  UpdateProxyRow: () => null,
}));

describe('UpdateCard', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.openReleasePage.mockClear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('opens the release list from the version row', async () => {
    const { UpdateCard } = await import('@renderer/features/settings/components/UpdateCard');
    await act(async () => root.render(createElement(UpdateCard)));

    const releaseButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="settings.update.viewReleases"]'
    );
    expect(releaseButton).not.toBeNull();

    await act(async () => releaseButton?.click());

    expect(mocks.openReleasePage).toHaveBeenCalledOnce();
  });
});
