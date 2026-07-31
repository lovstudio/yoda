import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prompt } from '@shared/prompt-library';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  prompts: [
    {
      id: 'global-enabled',
      title: 'Detailed global prompt',
      description: '',
      content: 'Prompt content',
      groupName: 'Writing',
      extraInfo: '',
      injectionEnabled: true,
      injectionOrder: 0,
      createdAt: '2026-07-31T00:00:00.000Z',
      updatedAt: '2026-07-31T00:00:00.000Z',
    },
    {
      id: 'global-disabled',
      title: 'Another detailed prompt',
      description: '',
      content: 'Prompt content',
      groupName: 'Writing',
      extraInfo: '',
      injectionEnabled: false,
      injectionOrder: 1,
      createdAt: '2026-07-31T00:00:00.000Z',
      updatedAt: '2026-07-31T00:00:00.000Z',
    },
  ] satisfies Prompt[],
  settingsStore: {
    settings: {
      promptPrinciples: {
        items: [
          {
            id: 'project-enabled',
            name: 'Detailed project prompt',
            text: 'Project prompt content',
            enabled: true,
          },
        ],
      },
    },
  },
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({
    t: (key: string, values?: { count?: number; label?: string }) => {
      if (key === 'home.enabledPromptCount') return `${values?.count ?? 0} enabled`;
      return key;
    },
  }),
}));

vi.mock('@renderer/features/prompt-library/use-prompts', () => ({
  usePrompts: () => ({ data: mocks.prompts }),
}));

vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  getProjectSettingsStore: () => mocks.settingsStore,
}));

vi.mock('@renderer/features/tasks/components/permission-mode-select', async () => {
  const React = await import('react');
  return {
    PermissionModeSelect: () =>
      React.createElement('div', { 'data-slot': 'permission-mode-select' }),
  };
});

vi.mock('@renderer/features/tasks/components/auto-trust-worktrees-control', async () => {
  const React = await import('react');
  return {
    AutoTrustWorktreesControl: () =>
      React.createElement('div', { 'data-slot': 'auto-trust-worktrees-control' }),
  };
});

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    navigation: {
      navigate: mocks.navigate,
    },
  },
}));

vi.mock('@renderer/lib/ui/info-tooltip', async () => {
  const React = await import('react');
  return {
    InfoTooltip: ({ label }: { label: string }) =>
      React.createElement('button', { type: 'button', 'aria-label': label }),
  };
});

describe('ComposerSettingsContent', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement('div');
    host.style.width = '384px';
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('keeps the popover concise and sends detailed prompt management to Library', async () => {
    const { ComposerSettingsContent } = await import('@renderer/app/composer-settings-content');
    await act(async () => {
      root.render(
        createElement(ComposerSettingsContent, {
          runtimeId: 'codex',
          projectId: 'project-1',
          attachImagesAsPaths: true,
          inputPromptLanguage: 'skip',
          namingLanguage: 'app',
          summaryLanguage: 'app',
          onAttachImagesAsPathsChange: vi.fn(),
          onInputPromptLanguageChange: vi.fn(),
          onNamingLanguageChange: vi.fn(),
          onSummaryLanguageChange: vi.fn(),
        })
      );
    });

    expect(host.querySelectorAll('section')).toHaveLength(3);
    expect(host.querySelector('[data-slot="permission-mode-select"]')).not.toBeNull();
    expect(host.querySelector('[data-slot="auto-trust-worktrees-control"]')).not.toBeNull();
    expect(host.textContent).toContain('2 enabled');
    expect(host.textContent).not.toContain('Detailed global prompt');
    expect(host.textContent).not.toContain('Detailed project prompt');
    expect(host.querySelector('[data-slot="prompt-injection-controls"]')).toBeNull();

    const libraryButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('home.openPromptLibrary')
    );
    await act(async () => libraryButton?.click());

    expect(mocks.navigate).toHaveBeenCalledWith('library', { section: 'prompts' });
  });
});
