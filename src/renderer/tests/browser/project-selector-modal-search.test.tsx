import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { Project } from '@shared/projects';
import { resolveHomeProjectId } from '@renderer/app/home-project-selection';
import { ProjectSelector } from '@renderer/features/tasks/create-task-modal/project-selector';
import { Dialog, DialogContent } from '@renderer/lib/ui/dialog';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => {
  const project = (id: string, name: string, path: string, updatedAt: string): Project => ({
    type: 'local',
    id,
    name,
    alias: null,
    path,
    baseRef: 'main',
    workspaceId: null,
    isInternal: false,
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt,
  });
  return {
    manager: {
      projects: new Map([
        [
          'visualizer',
          {
            data: project(
              'visualizer',
              '算法可视化',
              '/Users/mark/yoda/repositories/算法可视化',
              '2026-07-31T00:00:00.000Z'
            ),
          },
        ],
        [
          'blog',
          {
            data: project(
              'blog',
              '科技博主的自我修养',
              '/Users/mark/yoda/repositories/科技博主的自我修养',
              '2026-08-02T00:00:00.000Z'
            ),
          },
        ],
        [
          'yoda',
          {
            data: project(
              'yoda',
              'Yoda',
              '/Users/mark/lovstudio/coding/yoda',
              '2026-08-01T00:00:00.000Z'
            ),
          },
        ],
      ]),
      mountProject: vi.fn().mockResolvedValue(undefined),
      createProject: vi.fn(),
      ensureProjectLoaded: vi.fn(),
    },
    ensureProjectExpanded: vi.fn(),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  getProjectManagerStore: () => mocks.manager,
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    app: { openSelectDirectoryDialog: vi.fn() },
    projects: { inspectProjectPath: vi.fn() },
  },
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  useShowModal: () => vi.fn(),
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    sidebar: { ensureProjectExpanded: mocks.ensureProjectExpanded },
  },
}));

vi.mock('@renderer/utils/logger', () => ({
  log: { error: vi.fn() },
}));

function ProjectSelectorDialog() {
  const [draftProjectId, setDraftProjectId] = useState<string | null | undefined>(undefined);
  const projectId = resolveHomeProjectId({
    navigationProjectId: 'visualizer',
    draftProjectId,
  });
  return (
    <Dialog open>
      <DialogContent>
        <ProjectSelector value={projectId} onChange={(next) => setDraftProjectId(next ?? null)} />
        <output data-slot="selected-project">{projectId}</output>
      </DialogContent>
    </Dialog>
  );
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!valueSetter) throw new Error('HTMLInputElement value setter is missing');
  valueSetter.call(input, value);
  input.dispatchEvent(
    new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' })
  );
}

async function openProjectSearch(query: string): Promise<HTMLElement[]> {
  const trigger = document.querySelector<HTMLButtonElement>('[data-slot="combobox-trigger"]');
  if (!trigger) throw new Error('Project selector trigger is missing');
  await act(async () => trigger.click());

  const input = document.querySelector<HTMLInputElement>(
    'input[placeholder="projects.searchProjects"]'
  );
  if (!input) throw new Error('Project search input is missing');
  await act(async () => {
    input.focus();
    setInputValue(input, query);
  });
  expect(document.activeElement).toBe(input);

  return Array.from(document.querySelectorAll<HTMLElement>('[data-slot="combobox-item"]'));
}

function pressKey(input: HTMLInputElement, key: string): void {
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

describe('ProjectSelector in a modal', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await page.viewport(900, 700);
    // Recency order is persisted, so earlier selections must not leak between tests.
    window.localStorage.removeItem('yoda:project-selector:recent-project-ids');
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(createElement(ProjectSelectorDialog));
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  it('orders projects by most recently updated first', async () => {
    const items = await openProjectSearch('');
    const projectOrder = items
      .map((item) => item.textContent)
      .filter((text): text is string =>
        ['算法可视化', '科技博主的自我修养', 'Yoda'].some((name) => text?.includes(name))
      )
      .map((text) => {
        if (text.includes('科技博主的自我修养')) return 'blog';
        if (text.includes('Yoda')) return 'yoda';
        return 'visualizer';
      });

    expect(projectOrder).toEqual(['blog', 'yoda', 'visualizer']);
  });

  it('moves the most recently picked project to the top', async () => {
    const items = await openProjectSearch('');
    const visualizer = items.find((item) => item.textContent?.includes('算法可视化'));
    if (!visualizer) throw new Error('Expected the visualizer project option');
    await act(async () => visualizer.click());

    const reopened = await openProjectSearch('');
    const firstProject = reopened.find((item) =>
      ['算法可视化', '科技博主的自我修养', 'Yoda'].some((name) => item.textContent?.includes(name))
    );

    expect(firstProject?.textContent).toContain('算法可视化');
  });

  it('ignores a shared parent path when filtering by a project keyword', async () => {
    const items = await openProjectSearch('yoda');
    const visualizer = items.find((item) => item.textContent?.includes('算法可视化'));
    const blog = items.find((item) => item.textContent?.includes('科技博主的自我修养'));
    const yoda = items.find((item) => item.textContent?.includes('Yoda'));

    expect(visualizer).toBeUndefined();
    expect(blog).toBeUndefined();
    expect(yoda).toBeDefined();

    await act(async () => yoda?.click());
    expect(document.querySelector<HTMLOutputElement>('[data-slot="selected-project"]')?.value).toBe(
      'yoda'
    );
  });

  it('keeps full-path search when the query is explicitly path-like', async () => {
    const items = await openProjectSearch('/Users/mark/yoda/repositories/算法');
    const visualizer = items.find((item) => item.textContent?.includes('算法可视化'));
    const blog = items.find((item) => item.textContent?.includes('科技博主的自我修养'));
    const yoda = items.find((item) => item.textContent?.includes('Yoda'));

    expect(visualizer).toBeDefined();
    expect(blog).toBeUndefined();
    expect(yoda).toBeUndefined();
  });

  it('navigates options with arrow keys and selects the highlighted option', async () => {
    const items = await openProjectSearch('yoda');
    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder="projects.searchProjects"]'
    );
    const yoda = items.find((item) => item.textContent?.includes('Yoda'));
    const browse = items.find((item) => item.textContent?.includes('projects.browseForFolder'));

    if (!input || !yoda || !browse)
      throw new Error('Expected project selector options are missing');
    expect(yoda).toHaveAttribute('data-highlighted');
    expect(yoda).toHaveClass('data-highlighted:border-foreground/70');
    expect(yoda).toHaveClass('data-highlighted:bg-background-3');

    await act(async () => pressKey(input, 'ArrowDown'));
    expect(browse).toHaveAttribute('data-highlighted');
    expect(yoda).not.toHaveAttribute('data-highlighted');

    await act(async () => pressKey(input, 'ArrowUp'));
    expect(yoda).toHaveAttribute('data-highlighted');

    await act(async () => pressKey(input, 'Enter'));
    expect(document.querySelector<HTMLOutputElement>('[data-slot="selected-project"]')?.value).toBe(
      'yoda'
    );
  });
});
