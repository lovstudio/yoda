import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionSummarySnapshot } from '@shared/conversations';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  conversation: {
    id: 'conversation-1',
    projectId: 'project-1',
    taskId: 'task-1',
    runtimeId: 'codex',
    title: 'Stable popover',
    createdAt: null,
  },
  getSessionSummary: vi.fn(),
  getSessionSummarySnapshot: vi.fn(),
  getSessionSummaryPreview: vi.fn(),
  getConversationNamingSnapshot: vi.fn(),
  getConversationNamingPreview: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/features/tasks/components/naming-debug-ui', async () => {
  const { createElement: create } = await import('react');
  type ContentProps = { children?: ReactNode };
  type PanelProps = { context: { isLoading?: boolean; sources?: unknown[] | null } };
  return {
    formatNamingDebugTokenCount: () => '-',
    getNamingDebugContextStats: () => null,
    getNamingDebugDurationEstimate: () => null,
    NamingDebugContent: ({ children }: ContentProps) =>
      create('div', { className: 'min-h-0 flex-1 overflow-y-auto' }, children),
    NamingDebugPanel: ({ context }: PanelProps) =>
      create(
        'div',
        {
          'data-testid': 'async-popover-content',
          'data-loaded': context.sources?.length ? 'true' : 'false',
          style: { height: context.sources?.length ? '900px' : '96px' },
        },
        context.isLoading ? 'loading' : 'loaded'
      ),
  };
});

vi.mock('@renderer/features/tasks/components/naming-panel-shared', () => ({
  buildNamingContextSection: (
    _translate: unknown,
    input: { context?: { sources?: unknown[] } | null; isLoading?: boolean }
  ) => ({
    isLoading: input.isLoading,
    sources: input.context?.sources,
  }),
  buildNamingSummaryItems: () => [],
  buildNamingTextSections: () => [],
  NamingPanelConfiguration: () => null,
}));

vi.mock('@renderer/features/tasks/components/summary-config-fields', () => ({
  SummaryConfigFields: () => null,
}));

vi.mock('@renderer/features/tasks/components/task-menu-session-info', () => ({
  buildTaskMenuSessionFields: vi.fn(),
  getTaskMenuConversation: () => mocks.conversation,
  resolveTaskMenuSessionFields: vi.fn(),
}));

vi.mock('@renderer/features/tasks/task-view-context', () => ({
  ProvisionedTaskProvider: () => null,
  TaskViewWrapper: () => null,
  useProvisionedTask: () => ({
    path: '/tmp/yoda-popover-test',
    workspace: { git: { branchName: 'test-branch' } },
  }),
  useProvisionedTaskOrNull: () => null,
  useTaskViewContext: () => ({ projectId: 'project-1', taskId: 'task-1', hosted: false }),
  useIsHostedTaskView: () => false,
  useTaskViewKind: () => 'ready',
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: { on: vi.fn(() => () => undefined) },
  rpc: {
    conversations: {
      getSessionSummary: mocks.getSessionSummary,
      getSessionSummarySnapshot: mocks.getSessionSummarySnapshot,
      getSessionSummaryPreview: mocks.getSessionSummaryPreview,
      getConversationNamingSnapshot: mocks.getConversationNamingSnapshot,
      getConversationNamingPreview: mocks.getConversationNamingPreview,
    },
  },
}));

async function settleLayout(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 150));
  });
}

describe('SessionOverviewAIButton popover positioning', () => {
  let host: HTMLDivElement;
  let root: Root;
  let resolveSnapshot: (snapshot: SessionSummarySnapshot) => void = () => {
    throw new Error('Snapshot resolver was not initialized');
  };

  beforeEach(() => {
    mocks.getSessionSummary.mockReset().mockResolvedValue({ summary: null, status: 'empty' });
    mocks.getSessionSummaryPreview.mockReset();
    mocks.getConversationNamingSnapshot.mockReset().mockResolvedValue(null);
    mocks.getConversationNamingPreview.mockReset().mockResolvedValue(null);
    mocks.getSessionSummarySnapshot.mockReset().mockReturnValue(
      new Promise<SessionSummarySnapshot>((resolve) => {
        resolveSnapshot = resolve;
      })
    );

    host = document.createElement('div');
    Object.assign(host.style, {
      position: 'fixed',
      right: '24px',
      bottom: '24px',
    });
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('keeps its anchor position while asynchronous content expands', async () => {
    const { SessionOverviewAIButton } = await import('@renderer/features/tasks/session-info-panel');
    await act(async () => root.render(createElement(SessionOverviewAIButton)));

    const trigger = host.querySelector<HTMLButtonElement>(
      'button[aria-label="tasks.sessionInfo.overviewAi"]'
    );
    await act(async () => trigger?.click());
    await settleLayout();

    const popup = document.querySelector<HTMLElement>('[data-slot="popover-content"]');
    expect(popup).not.toBeNull();
    expect(popup?.getAttribute('data-side')).toBe('top');
    const before = popup?.getBoundingClientRect();

    await act(async () => {
      resolveSnapshot({
        conversationId: 'conversation-1',
        projectId: 'project-1',
        taskId: 'task-1',
        status: 'ready',
        model: 'test-model',
        runtimeId: 'codex',
        runtimeName: 'Codex',
        language: 'zh-CN',
        context: {
          version: 1,
          taskId: 'task-1',
          projectId: 'project-1',
          createdAt: new Date().toISOString(),
          language: 'zh-CN',
          model: 'test-model',
          estimatedTokens: 400,
          estimatedCharacters: 1_600,
          sourceCount: 1,
          sources: [
            {
              id: 'prompt',
              label: 'Prompt',
              content: 'Expanded asynchronous content',
              estimatedTokens: 400,
            },
          ],
        },
        generatedSummary: 'Done',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });
    await settleLayout();

    expect(
      document.querySelector('[data-testid="async-popover-content"]')?.getAttribute('data-loaded')
    ).toBe('true');
    const after = popup?.getBoundingClientRect();
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    expect(Math.abs((after?.top ?? 0) - (before?.top ?? 0))).toBeLessThan(1);
    expect(Math.abs((after?.left ?? 0) - (before?.left ?? 0))).toBeLessThan(1);
    expect(Math.abs((after?.height ?? 0) - (before?.height ?? 0))).toBeLessThan(1);
  });
});
