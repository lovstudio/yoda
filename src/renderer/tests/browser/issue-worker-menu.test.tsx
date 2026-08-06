import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/features/integrations/use-issue-worker', () => ({
  useIssueWorker: () => ({
    status: {
      data: {
        projectId: 'project-1',
        state: 'idle',
        config: {
          enabled: true,
          runtime: 'codex',
          concurrency: 2,
          pollIntervalSeconds: 60,
          managedTaskIds: [],
        },
        activeCount: 0,
        queuedCount: 0,
        lastSyncAt: null,
        nextSyncAt: null,
        lastError: null,
      },
    },
    configure: { isPending: false, mutate: vi.fn() },
    runNow: { isPending: false, mutate: vi.fn() },
  }),
}));

describe('Issue worker menu', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
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

  it('opens with its label inside the required Base UI menu group', async () => {
    const { IssueWorkerMenu } = await import(
      '@renderer/features/projects/components/issues-view/issue-worker-menu'
    );
    await act(async () =>
      root.render(
        createElement(IssueWorkerMenu, {
          projectId: 'project-1',
          defaultRuntime: 'codex',
          taskableCount: 0,
          isCreatingTasks: false,
          onCreateTasks: vi.fn(),
        })
      )
    );

    const trigger = host.querySelector<HTMLButtonElement>(
      'button[aria-label="issues.worker.menu"]'
    );
    expect(trigger).not.toBeNull();
    await act(async () => trigger?.click());

    const label = document.querySelector('[data-slot="dropdown-menu-label"]');
    expect(label?.textContent).toContain('issues.worker.menu');
    expect(label?.parentElement?.dataset.slot).toBe('dropdown-menu-group');
  });
});
