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
  const project = (id: string, name: string, path: string): Project => ({
    type: 'local',
    id,
    name,
    alias: null,
    path,
    baseRef: 'main',
    workspaceId: null,
    isInternal: false,
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  });
  return {
    manager: {
      projects: new Map([
        ['alpha', { data: project('alpha', 'Alpha', '/workspace/alpha') }],
        ['beta', { data: project('beta', 'Beta', '/workspace/beta') }],
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
    navigationProjectId: 'alpha',
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

describe('ProjectSelector in a modal', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await page.viewport(900, 700);
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

  it('filters projects and selects the match while the new-task dialog traps focus', async () => {
    const trigger = document.querySelector<HTMLButtonElement>('[data-slot="combobox-trigger"]');
    if (!trigger) throw new Error('Project selector trigger is missing');
    await act(async () => trigger.click());

    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder="projects.searchProjects"]'
    );
    if (!input) throw new Error('Project search input is missing');
    await act(async () => {
      input.focus();
      setInputValue(input, 'beta');
    });

    const items = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="combobox-item"]'));
    const alpha = items.find((item) => item.textContent?.includes('Alpha'));
    const beta = items.find((item) => item.textContent?.includes('Beta'));

    expect(document.activeElement).toBe(input);
    expect(alpha).toBeUndefined();
    expect(beta).toBeDefined();

    await act(async () => beta?.click());
    expect(document.querySelector<HTMLOutputElement>('[data-slot="selected-project"]')?.value).toBe(
      'beta'
    );
  });
});
