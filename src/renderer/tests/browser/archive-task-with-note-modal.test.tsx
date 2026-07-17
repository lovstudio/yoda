import { act, createElement, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DialogModule from '@renderer/lib/ui/dialog';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  archiveTask: vi.fn(async () => {}),
  navigate: vi.fn(),
}));

const translations: Record<string, string> = {
  'tasks.archiveWithNote.title': 'Archive task',
  'tasks.archiveWithNote.skillLabel': 'Run skill before archiving',
  'tasks.archiveWithNote.skillDescription':
    'Sent to every live session before archiving; waits for the agent to finish.',
  'tasks.archiveWithNote.label': 'Note (optional)',
  'tasks.archiveWithNote.placeholder': 'Why are you archiving this task?',
  'tasks.archiveWithNote.submit': 'Archive',
  'tasks.context.configureArchiveSkill': 'Configure pre-archive skill…',
  'settings.tasks.preArchiveCommandPlaceholder': 'Skill command',
  'common.cancel': 'Cancel',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => translations[key] ?? key }),
}));

vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({
    value: { preArchiveCommand: 'lovstudio-git-commit-with-context' },
  }),
}));

vi.mock('@renderer/features/tasks/archive-task', () => ({
  useArchiveTask: () => ({ archiveTask: mocks.archiveTask }),
}));

vi.mock('@renderer/features/tasks/components/task-menu-session-info', () => ({
  getTaskMenuConversation: () => ({ runtimeId: 'codex' }),
}));

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  asProvisioned: () => ({}),
  getTaskStore: () => ({}),
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({ toast: vi.fn() }));

vi.mock('@renderer/lib/layout/navigation-provider', () => ({
  useNavigate: () => ({ navigate: mocks.navigate }),
}));

vi.mock('@renderer/lib/ui/dialog', async (importOriginal) => {
  const actual = await importOriginal<typeof DialogModule>();
  const element = (tag: 'div' | 'h2', slot: string) =>
    function MockDialogElement({ children }: { children?: ReactNode }) {
      return createElement(tag, { 'data-slot': slot }, children);
    };

  return {
    ...actual,
    DialogContentArea: element('div', 'dialog-content-area'),
    DialogHeader: element('div', 'dialog-header'),
    DialogTitle: element('h2', 'dialog-title'),
  };
});

vi.mock('@renderer/lib/ui/confirm-button', async () => {
  const { Button } = await import('@renderer/lib/ui/button');
  return {
    ConfirmButton: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) =>
      createElement(Button, props, children),
  };
});

describe('ArchiveTaskWithNoteModal footer', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    host.className = 'ylight';
    host.style.width = '384px';
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('keeps the archive action inside the small modal footer', async () => {
    const { ArchiveTaskWithNoteModal } = await import(
      '@renderer/features/tasks/archive-task-with-note-modal'
    );

    await act(async () => {
      root.render(
        createElement(ArchiveTaskWithNoteModal, {
          projectId: 'project-1',
          taskId: 'task-1',
          taskName: 'Fix the context menu',
          withSkill: true,
          onSuccess: vi.fn(),
          onClose: vi.fn(),
        })
      );
    });

    const footer = host.querySelector<HTMLElement>('[data-slot="dialog-footer"]');
    const archiveButton = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === 'Archive'
    );

    expect(footer).not.toBeNull();
    expect(archiveButton).not.toBeUndefined();
    expect(footer?.scrollWidth).toBeLessThanOrEqual(footer?.clientWidth ?? 0);
    expect(archiveButton?.getBoundingClientRect().right).toBeLessThanOrEqual(
      footer?.getBoundingClientRect().right ?? 0
    );
  });
});
