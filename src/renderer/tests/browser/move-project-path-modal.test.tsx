import { act, createElement, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18next from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ChildrenProps = { children?: ReactNode };

const mocks = vi.hoisted(() => ({
  inspectProjectPath: vi.fn(),
  moveProjectPath: vi.fn(),
  projectStore: {
    displayName: '重命名后的项目',
    data: {
      type: 'local' as const,
      id: 'project-1',
      name: 'old-project-name',
      alias: '重命名后的项目',
      path: '/projects/old-project-name',
      baseRef: 'main',
      workspaceId: null,
      isInternal: false,
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z',
    },
  },
}));

// The modal reaches the i18n singleton through inline-error -> clipboard -> use-toast,
// so the mock has to keep every real export besides useTranslation alive.
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock(
  '@renderer/features/projects/components/add-project-modal/remote-directory-selector',
  () => ({
    RemoteDirectorySelector: () => null,
  })
);

vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  getProjectManagerStore: () => ({ moveProjectPath: mocks.moveProjectPath }),
  getProjectStore: () => mocks.projectStore,
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    app: { openSelectDirectoryDialog: vi.fn() },
    projects: { inspectProjectPath: mocks.inspectProjectPath },
  },
}));

vi.mock('@renderer/lib/ui/confirm-button', async () => {
  const { createElement: create } = await import('react');
  return {
    ConfirmButton: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) =>
      create('button', props, children),
  };
});

vi.mock('@renderer/lib/ui/dialog', async () => {
  const { createElement: create } = await import('react');
  const element =
    (tag: 'div' | 'h2', slot: string) =>
    ({ children }: ChildrenProps) =>
      create(tag, { 'data-slot': slot }, children);
  return {
    DialogContentArea: element('div', 'dialog-content-area'),
    DialogFooter: element('div', 'dialog-footer'),
    DialogHeader: element('div', 'dialog-header'),
    DialogTitle: element('h2', 'dialog-title'),
  };
});

function setInputValue(input: HTMLInputElement, value: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setValue?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('MoveProjectPathModal', () => {
  let host: HTMLDivElement;
  let root: Root;
  let onSuccess: (result: void) => void;

  beforeEach(() => {
    mocks.inspectProjectPath.mockReset().mockResolvedValue({
      isDirectory: false,
      isGitRepo: false,
    });
    mocks.moveProjectPath.mockReset().mockResolvedValue(undefined);
    onSuccess = vi.fn((_result: void) => {});
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('uses the latest project display name and submits a missing target path', async () => {
    const { MoveProjectPathModal } = await import(
      '@renderer/features/projects/components/move-project-path-modal'
    );
    await act(async () => {
      root.render(
        createElement(MoveProjectPathModal, {
          projectId: 'project-1',
          onSuccess,
          onClose: vi.fn(),
        })
      );
    });

    const inputs = host.querySelectorAll<HTMLInputElement>('input');
    expect(inputs.item(0).value).toBe('重命名后的项目');
    expect(inputs.item(0).maxLength).toBe(80);

    await act(async () => {
      setInputValue(inputs.item(1), '/projects/new-parent/重命名后的项目');
    });
    const buttons = host.querySelectorAll<HTMLButtonElement>('[data-slot="dialog-footer"] button');
    await act(async () => buttons.item(buttons.length - 1).click());

    expect(mocks.inspectProjectPath).toHaveBeenCalledWith({
      type: 'local',
      path: '/projects/new-parent/重命名后的项目',
    });
    expect(mocks.moveProjectPath).toHaveBeenCalledWith('project-1', {
      name: '重命名后的项目',
      path: '/projects/new-parent/重命名后的项目',
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});
