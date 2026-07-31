import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { DEFAULT_TASK_APPEARANCE_SETTINGS } from '@shared/task-appearance';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  resetField: vi.fn(),
  update: vi.fn(),
  appearance: {
    standard: {
      titleStyle: 'regular' as const,
      idleOpacity: 100 as const,
      marker: 'none' as const,
    },
    longTerm: {
      titleStyle: 'italic' as const,
      idleOpacity: 70 as const,
      marker: 'none' as const,
    },
    multiAgent: {
      marker: 'users' as const,
    },
  },
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({
    value: {
      taskHoverAction: 'delete',
      autoRightSidebarBehavior: false,
      newTaskOpenMode: 'home',
      agentReplyDisplayLevel: 'concise',
      dockSessionHistory: true,
      dockSessionHistoryRows: 3,
      taskAppearance: mocks.appearance,
    },
    update: mocks.update,
    isLoading: false,
    isSaving: false,
    isFieldOverridden: () => true,
    resetField: mocks.resetField,
  }),
}));

describe('TaskAppearanceSettingsCard', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.clearAllMocks();
    host = document.createElement('div');
    host.style.width = '360px';
    document.body.appendChild(host);
    root = createRoot(host);

    const { default: TaskAppearanceSettingsCard } = await import(
      '@renderer/features/settings/components/TaskAppearanceSettingsCard'
    );
    await act(async () => root.render(createElement(TaskAppearanceSettingsCard)));
    await settle();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.querySelectorAll('[data-slot="select-content"]').forEach((node) => node.remove());
    host.remove();
  });

  it('previews the established long-term style and updates the whole nested preset', async () => {
    const longTermSample = Array.from(host.querySelectorAll('span')).find(
      (node) => node.textContent === 'settings.taskAppearance.longTermSample'
    );
    expect(longTermSample?.className).toContain('italic');
    expect(longTermSample?.parentElement?.className).toContain('opacity-70');

    const textStyleTriggers = host.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="settings.taskAppearance.titleStyle"]'
    );
    expect(textStyleTriggers).toHaveLength(2);
    await userEvent.click(textStyleTriggers[1]!);
    await settle();

    const mediumOption = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="select-item"]')
    ).find((node) => node.textContent === 'settings.taskAppearance.titleStyleMedium');
    if (!mediumOption) throw new Error('Long-term medium style option is missing');
    await userEvent.click(mediumOption);
    await settle();

    expect(mocks.update).toHaveBeenCalledWith({
      taskAppearance: {
        ...DEFAULT_TASK_APPEARANCE_SETTINGS,
        longTerm: {
          ...DEFAULT_TASK_APPEARANCE_SETTINGS.longTerm,
          titleStyle: 'medium',
        },
      },
    });
  });

  it('resets the appearance field and stays within a narrow settings surface', async () => {
    const reset = host.querySelector<HTMLButtonElement>(
      'button[aria-label="settings.keyboard.resetToDefault"]'
    );
    await act(async () => reset?.click());
    expect(mocks.resetField).toHaveBeenCalledWith('taskAppearance');

    const card = host.querySelector<HTMLElement>('[data-testid="task-appearance-settings"]');
    expect(card).not.toBeNull();
    const cardRight = card!.getBoundingClientRect().right;
    const overflowingElements = Array.from(card!.querySelectorAll<HTMLElement>('*'))
      .filter((element) => element.getBoundingClientRect().right > cardRight + 1)
      .map((element) => ({
        tag: element.tagName,
        text: element.textContent?.slice(0, 80),
        width: element.getBoundingClientRect().width,
      }));
    expect(overflowingElements).toEqual([]);
  });
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}
