import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prompt } from '@shared/prompt-library';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setGroupInjection: vi.fn(),
  updatePrompt: vi.fn(),
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
    save: vi.fn(async () => ({ success: true })),
  },
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({
    t: (
      key: string,
      values?: { count?: number; enabled?: number; label?: string; name?: string }
    ) => {
      if (key === 'home.enabledPromptCount') return `${values?.count ?? 0} enabled`;
      if (key === 'home.openPromptLibrary') return 'Manage prompts in Library';
      if (key === 'promptLibrary.injection.toggle') return `toggle ${values?.name ?? ''}`;
      return key;
    },
  }),
}));

vi.mock('@renderer/features/prompt-library/use-prompts', () => ({
  usePrompts: () => ({ data: mocks.prompts }),
  useSetPromptGroupInjectionEnabled: () => ({
    mutate: mocks.setGroupInjection,
    isPending: false,
  }),
  useUpdatePrompt: () => ({ mutate: mocks.updatePrompt, isPending: false }),
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

    const settingsSections = host.querySelectorAll<HTMLElement>(
      '[data-slot="composer-settings-section"]'
    );
    expect(settingsSections).toHaveLength(3);
    expect(host.querySelector('[data-slot="permission-mode-select"]')).not.toBeNull();
    expect(host.querySelector('[data-slot="auto-trust-worktrees-control"]')).not.toBeNull();
    const promptHeader = settingsSections[2]?.querySelector(
      '[data-slot="composer-settings-section-header"]'
    );
    expect(promptHeader?.textContent).toContain('(2)');
    expect(promptHeader?.querySelector('[aria-label="2 enabled"]')).not.toBeNull();
    expect(promptHeader?.querySelector('[aria-label="Manage prompts in Library"]')).not.toBeNull();
    expect(host.textContent).not.toContain('home.promptConfigurationDescription');
    expect(host.textContent).toContain('Detailed global prompt');
    expect(host.textContent).toContain('Detailed project prompt');
    expect(host.textContent).not.toContain('Prompt content');
    expect(host.textContent).not.toContain('Project prompt content');
    expect(
      host.querySelector('[data-slot="prompt-injection-controls"][data-variant="compact"]')
    ).not.toBeNull();
    const promptList = host.querySelector<HTMLElement>('[data-slot="compact-prompt-list"]');
    expect(promptList).not.toBeNull();
    expect(promptList?.className).not.toContain('overflow-y-auto');
    expect(host.querySelectorAll('[data-slot="prompt-injection-row"]')).toHaveLength(2);
    expect(host.querySelectorAll('[data-slot="project-prompt-injection-row"]')).toHaveLength(1);

    const projectPromptToggle = host.querySelector<HTMLButtonElement>(
      '[aria-label="toggle Detailed project prompt"]'
    );
    await act(async () => projectPromptToggle?.click());
    expect(mocks.settingsStore.save).toHaveBeenCalled();

    const libraryButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Manage prompts in Library"]'
    );
    await act(async () => libraryButton?.click());

    expect(mocks.navigate).toHaveBeenCalledWith('library', { section: 'prompts' });
  });
});
