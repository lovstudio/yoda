import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClaudeSessionPrompt, ProjectPromptSource } from '@shared/conversations';
import { ProjectPromptsCard } from '@renderer/features/projects/components/overview-view/project-prompts-card';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getProjectConversationPrompts: vi.fn(),
  navigate: vi.fn(),
  openSession: vi.fn(),
  prepareSession: vi.fn(),
  showPrompt: vi.fn(),
  showConfirm: vi.fn(),
}));

const sources: ProjectPromptSource[] = [
  projectSource('newer', 'task-newer', 'Newer task', '2026-07-28T10:00:00.000Z'),
  projectSource('older', 'task-older', 'Older task', '2026-07-27T10:00:00.000Z'),
];

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal()),
  useQuery: () => ({
    data: sources,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values?.count === undefined ? key : `${key}:${String(values.count)}`,
  }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    conversations: {
      getProjectPromptSources: vi.fn(),
      getProjectConversationPrompts: mocks.getProjectConversationPrompts,
    },
  },
}));

vi.mock('@renderer/lib/components/agent-logo', () => ({
  default: ({ alt }: { alt: string }) => createElement('span', { 'aria-label': alt }),
}));

vi.mock('@renderer/lib/layout/navigation-provider', () => ({
  useNavigate: () => ({ navigate: mocks.navigate }),
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  useShowModal: (id: string) =>
    id === 'sessionPromptsModal' ? mocks.showPrompt : mocks.showConfirm,
}));

vi.mock('@renderer/features/projects/components/sessions-view/project-session-open', () => ({
  openProjectSessionConversation: mocks.openSession,
  prepareProjectSessionConversation: mocks.prepareSession,
}));

vi.mock('@renderer/features/tasks/conversations/use-conversation-prompt-restore', () => ({
  forkConversationAtPromptIntoNewTab: vi.fn(),
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@renderer/utils/logger', () => ({
  log: { warn: vi.fn() },
}));

vi.mock('@renderer/lib/ui/relative-time', () => ({
  RelativeTime: ({ value }: { value: string }) => createElement('time', null, value),
}));

describe('ProjectPromptsCard', () => {
  let host: HTMLDivElement;
  let root: Root;
  let resolveNewer: (prompts: ClaudeSessionPrompt[]) => void;
  let resolveOlder: (prompts: ClaudeSessionPrompt[]) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.openSession.mockResolvedValue(undefined);
    mocks.getProjectConversationPrompts.mockImplementation(
      (_projectId: string, conversationId: string) =>
        new Promise<ClaudeSessionPrompt[]>((resolve) => {
          if (conversationId === 'newer') resolveNewer = resolve;
          else resolveOlder = resolve;
        })
    );
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('streams completed files into newest-first order and exposes the shared actions', async () => {
    await act(async () =>
      root.render(createElement(ProjectPromptsCard, { projectId: 'project-1' }))
    );

    expect(
      host.querySelector('[aria-label="projects.promptHistory.filterByTask"]')?.textContent
    ).toContain('projects.promptHistory.allTasks');
    expect(host.querySelector('[aria-label="projects.promptHistory.sort"]')?.textContent).toContain(
      'projects.promptHistory.newestFirst'
    );

    await act(async () => {
      resolveOlder([prompt('older-1', 'Older prompt', '2026-07-27T10:00:00.000Z')]);
    });
    expect(promptTexts()).toEqual(['Older prompt']);

    await act(async () => {
      resolveNewer([
        prompt('newer-1', 'Newer prompt 1', '2026-07-28T09:00:00.000Z'),
        prompt('newer-2', 'Newer prompt 2', '2026-07-28T09:10:00.000Z'),
        prompt('newer-3', 'Newer prompt 3', '2026-07-28T09:20:00.000Z'),
        prompt('newer-4', 'Newer prompt 4', '2026-07-28T09:30:00.000Z'),
        prompt('newer-5', 'Newer prompt 5', '2026-07-28T09:40:00.000Z'),
      ]);
    });

    expect(promptTexts()).toEqual([
      'Newer prompt 5',
      'Newer prompt 4',
      'Newer prompt 3',
      'Newer prompt 2',
      'Newer prompt 1',
    ]);

    const viewAll = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.startsWith('projects.promptHistory.viewAll')
    );
    await act(async () => viewAll?.click());
    expect(promptTexts()).toEqual([
      'Newer prompt 5',
      'Newer prompt 4',
      'Newer prompt 3',
      'Newer prompt 2',
      'Newer prompt 1',
      'Older prompt',
    ]);

    const firstPrompt = [...host.querySelectorAll<HTMLButtonElement>('ol button')].find(
      (button) => button.textContent === 'Newer prompt 5'
    );
    await act(async () => firstPrompt?.click());
    expect(mocks.showPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        prompts: [expect.objectContaining({ id: 'newer-5' })],
        promptNumbers: [5],
        sessionTitle: 'newer · Newer task',
      })
    );

    const firstRow = host.querySelector('ol > li');
    expect(firstRow?.textContent).not.toContain('Newer task');
    expect(
      host.querySelector('button[aria-label="projects.promptHistory.openNamedSession"]')
    ).toBeNull();

    const moreButton = firstRow?.querySelector<HTMLButtonElement>(
      'button[aria-label="common.more"]'
    );
    await act(async () => {
      moreButton?.click();
      await Promise.resolve();
    });
    expect(document.querySelector('[data-project-prompt-session]')?.textContent).toContain(
      'Newer task'
    );

    const openSessionItem = [
      ...document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'),
    ].find((item) => item.textContent?.includes('projects.promptHistory.openSession'));
    await act(async () => openSessionItem?.click());
    expect(mocks.openSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'newer' }),
      mocks.navigate,
      { id: 'newer-5', index: 4 }
    );
  });

  function promptTexts(): string[] {
    return [...host.querySelectorAll('ol > li > button')].flatMap((button) => {
      const text = button.textContent?.trim();
      return text?.includes('prompt') ? [text] : [];
    });
  }
});

function projectSource(
  conversationId: string,
  taskId: string,
  taskName: string,
  lastInteractedAt: string
): ProjectPromptSource {
  return {
    conversation: {
      id: conversationId,
      projectId: 'project-1',
      taskId,
      runtimeId: 'codex',
      title: conversationId,
      lastInteractedAt,
      isInitialConversation: false,
    },
    taskName,
    taskArchivedAt: null,
  };
}

function prompt(id: string, text: string, timestamp: string): ClaudeSessionPrompt {
  return {
    id,
    text,
    timestamp,
    restoreTarget: { kind: 'codex-turn', turnId: `turn-${id}` },
  };
}
