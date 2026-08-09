import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  resetField: vi.fn(),
  setSoundSettings: vi.fn(),
  update: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({
    value: {
      enabled: true,
      sound: true,
      osNotifications: true,
      soundFocusMode: 'unfocused',
      permissionNotifications: true,
      questionNotifications: true,
      accountUsageWarningEnabled: true,
      accountUsageWarningThreshold: 95,
    },
    update: mocks.update,
    isLoading: false,
    isFieldOverridden: () => false,
    resetField: mocks.resetField,
  }),
}));

vi.mock('@renderer/utils/soundPlayer', () => ({
  setSoundSettings: mocks.setSoundSettings,
}));

describe('NotificationSettingsCard', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.clearAllMocks();
    host = document.createElement('div');
    host.style.width = '360px';
    document.body.appendChild(host);
    root = createRoot(host);

    const { default: NotificationSettingsCard } = await import(
      '@renderer/features/settings/components/NotificationSettingsCard'
    );
    await act(async () => root.render(createElement(NotificationSettingsCard)));
    await settle();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.querySelectorAll('[data-slot="select-content"]').forEach((node) => node.remove());
    host.remove();
  });

  it('keeps the three event rows usable in a narrow settings surface', async () => {
    const card = host.querySelector<HTMLElement>('[data-testid="notification-settings-card"]');
    expect(card).not.toBeNull();
    expect(host.querySelectorAll('[role="switch"]')).toHaveLength(2);
    expect(
      host.querySelector('[aria-label="settings.notifications.turnCompletion"]')
    ).not.toBeNull();

    const cardRight = card!.getBoundingClientRect().right;
    const overflowingElements = Array.from(card!.querySelectorAll<HTMLElement>('*'))
      .filter((element) => element.getBoundingClientRect().right > cardRight + 1)
      .map((element) => element.textContent?.slice(0, 80));
    expect(overflowingElements).toEqual([]);
  });

  it('persists completion timing and independent attention channels', async () => {
    const completionTrigger = host.querySelector<HTMLButtonElement>(
      '[aria-label="settings.notifications.turnCompletion"]'
    );
    await clickWithUserEvent(completionTrigger!);
    const never = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="select-item"]')
    ).find((item) => item.textContent === 'settings.notifications.deliveryModes.never');
    expect(never).not.toBeUndefined();
    await clickWithUserEvent(never!);
    await settle();

    const permissionSwitch = host.querySelector<HTMLButtonElement>(
      '[aria-label="settings.notifications.permissionNotifications"]'
    );
    await clickUser(permissionSwitch!);

    expect(mocks.update).toHaveBeenNthCalledWith(1, { sound: false });
    expect(mocks.update).toHaveBeenNthCalledWith(2, { permissionNotifications: false });
  });
});

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function clickUser(element: Element): Promise<void> {
  await act(async () => {
    (element as HTMLElement).click();
  });
  await settle();
}

async function clickWithUserEvent(element: Element): Promise<void> {
  await act(async () => {
    await userEvent.click(element);
  });
  await settle();
}
