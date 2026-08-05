import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => {
  const mountProject = vi.fn(async () => undefined);
  const loadSettings = vi.fn(async () => undefined);
  const saveSettings = vi.fn(async () => ({ success: true }));
  const projectStore = {
    data: {
      id: 'project-1',
      name: 'Project',
      isInternal: false,
    },
  };
  return {
    mountProject,
    loadSettings,
    saveSettings,
    projectStore,
    projectManager: {
      projects: new Map([['project-1', projectStore]]),
      mountProject,
    },
    settingsStore: {
      settings: {
        promptPrinciples: {
          globalOverrides: { 'global-prompt': false },
          items: [
            {
              id: 'project-prompt',
              name: 'Project rule',
              text: 'Project prompt content',
              enabled: true,
            },
          ],
        },
      },
      pageData: { load: loadSettings },
      save: saveSettings,
    },
  };
});

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  asMounted: (store: unknown) => store,
  getProjectManagerStore: () => mocks.projectManager,
  getProjectSettingsStore: () => mocks.settingsStore,
}));

vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({ value: { selectedProjectId: 'project-1' } }),
}));

vi.mock('@renderer/features/tasks/create-task-modal/project-selector', async () => {
  const React = await import('react');
  return {
    ProjectSelector: () => React.createElement('div', { 'data-slot': 'project-selector' }),
  };
});

vi.mock('@renderer/features/prompt-library/prompt-system-section', async () => {
  const React = await import('react');
  return {
    PromptInstructionFilesEditor: () =>
      React.createElement('div', { 'data-slot': 'project-instruction-files' }),
  };
});

vi.mock('@renderer/features/prompt-library/use-prompts', () => ({
  usePrompts: () => ({
    data: [
      {
        id: 'global-prompt',
        title: 'Global prompt',
        content: 'Global content',
        description: '',
        extraInfo: '',
        groupName: '',
        injectionEnabled: true,
        injectionOrder: 0,
      },
    ],
  }),
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    navigation: {
      currentViewId: 'library',
      viewParamsStore: { task: {}, project: {} },
    },
  },
}));

describe('ProjectPromptSection', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settingsStore.settings.promptPrinciples.items = [
      {
        id: 'project-prompt',
        name: 'Project rule',
        text: 'Project prompt content',
        enabled: true,
      },
    ];
    host = document.createElement('div');
    host.style.width = '440px';
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('uses compact project rows and does not repeat the global prompt list', async () => {
    const { ProjectPromptSection } = await import(
      '@renderer/features/prompt-library/project-prompt-section'
    );
    await act(async () => {
      root.render(
        createElement(ProjectPromptSection, {
          projectId: 'project-1',
          runtimeId: 'codex',
          onProjectIdChange: vi.fn(),
        })
      );
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(host.querySelectorAll('[data-slot="project-prompt-row"]')).toHaveLength(1)
      );
    });

    expect(host.textContent).not.toContain('promptLibrary.project.globalOverrides');
    expect(host.querySelector('[data-slot="project-instruction-files"]')).not.toBeNull();
    expect(host.querySelector('textarea')).toBeNull();

    const rowToggle = host.querySelector<HTMLButtonElement>(
      '[data-slot="project-prompt-row"] button[aria-expanded="false"]'
    );
    await act(async () => rowToggle?.click());
    expect(host.querySelector('textarea')?.getAttribute('placeholder')).toBe(
      'promptLibrary.project.contentPlaceholder'
    );

    const addButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('promptLibrary.project.add')
    );
    await act(async () => addButton?.click());
    await act(async () => {
      await vi.waitFor(() =>
        expect(host.querySelectorAll('[data-slot="project-prompt-row"]')).toHaveLength(2)
      );
    });
    expect(mocks.saveSettings).toHaveBeenCalled();
  });

  it('supports a fixed project with per-project global prompt overrides', async () => {
    const { ProjectPromptSection } = await import(
      '@renderer/features/prompt-library/project-prompt-section'
    );
    await act(async () => {
      root.render(
        createElement(ProjectPromptSection, {
          projectId: 'project-1',
          runtimeId: 'codex',
          onProjectIdChange: vi.fn(),
          showProjectSelector: false,
          showGlobalPrompts: true,
        })
      );
    });

    expect(host.querySelector('[data-slot="project-selector"]')).toBeNull();
    const globalToggle = host.querySelector<HTMLButtonElement>(
      '[data-slot="prompt-injection-row"] [data-slot="switch"]'
    );
    expect(globalToggle).not.toBeNull();
    await act(async () => globalToggle?.click());
    await act(async () => {
      await vi.waitFor(() => expect(mocks.saveSettings).toHaveBeenCalled());
    });
  });
});
