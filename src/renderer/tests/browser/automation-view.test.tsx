import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INTERNAL_PROJECT_ID } from '@shared/projects';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  run: vi.fn(),
  navigate: vi.fn(),
  openTaskTarget: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
}));

const fixtures = vi.hoisted(() => {
  const activeAutomation = {
    id: 'active-automation',
    source: 'yoda' as const,
    title: 'Daily product feedback',
    workspaceName: 'Product operations',
    prompt: 'Collect feedback from the inbox and summarize the three most important themes.',
    runtime: 'codex' as const,
    scheduleLabel: '',
    status: 'active' as const,
    triggerKind: 'cron' as const,
    cronExpr: '0 9 * * 1-5',
    timezone: null,
    projectId: null,
    nextRunAt: '2026-08-03T01:00:00.000Z',
    lastRunAt: '2026-07-31T01:00:00.000Z',
    createdAt: '2026-07-01T01:00:00.000Z',
    updatedAt: '2026-07-31T01:00:00.000Z',
  };
  const pausedAutomation = {
    ...activeAutomation,
    id: 'paused-automation',
    title: 'Weekly release notes',
    prompt: 'Prepare release notes from completed work.',
    status: 'paused' as const,
    triggerKind: 'manual' as const,
    cronExpr: null,
    nextRunAt: null,
  };
  const codexAutomation = {
    ...activeAutomation,
    id: 'codex-automation',
    source: 'codex' as const,
    title: 'Codex scheduled review',
    prompt: 'Review the project status from Codex.',
    status: 'paused' as const,
  };
  const recentRun = {
    id: 'run-1',
    automationId: activeAutomation.id,
    taskId: 'task-1',
    conversationId: 'conversation-1',
    trigger: 'cron',
    status: 'success' as const,
    startedAt: '2026-07-31T01:00:00.000Z',
    finishedAt: '2026-07-31T01:04:00.000Z',
    error: null,
  };
  return { activeAutomation, pausedAutomation, codexAutomation, recentRun };
});

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN', resolvedLanguage: 'zh-CN' },
  }),
}));

vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({ value: 'codex' }),
}));

vi.mock('@renderer/features/automation/use-automations', () => ({
  useAutomations: () => ({
    data: [fixtures.activeAutomation, fixtures.pausedAutomation, fixtures.codexAutomation],
    isLoading: false,
  }),
  useAutomationHistory: () => ({ data: [fixtures.recentRun] }),
  useCreateAutomation: () => ({
    mutate: mocks.create,
    isPending: false,
    variables: undefined,
  }),
  useUpdateAutomation: () => ({
    mutate: mocks.update,
    isPending: false,
    variables: undefined,
  }),
  useDeleteAutomation: () => ({
    mutate: mocks.remove,
    isPending: false,
    variables: undefined,
  }),
  useRunAutomation: () => ({
    mutate: mocks.run,
    isPending: false,
    variables: undefined,
  }),
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
  toast: mocks.toast,
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {},
  events: {
    emit: vi.fn(),
    on: () => vi.fn(),
  },
}));

vi.mock('@renderer/lib/layout/navigation-provider', () => ({
  useNavigate: () => ({ navigate: mocks.navigate }),
  useWorkspaceSlots: () => ({}),
  useWorkspaceWrapParams: () => ({}),
  ViewParamsOverrideProvider: ({ children }: { children: unknown }) => children,
  useIsPinHosted: () => false,
  useOpenViewTab: () => ({ openViewTab: mocks.navigate }),
  useParams: () => ({ params: {}, setParams: vi.fn() }),
  isCurrentView: () => false,
}));

vi.mock('@renderer/app/open-task-target', async (importOriginal) => ({
  ...(await importOriginal()),
  openTaskTarget: mocks.openTaskTarget,
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  useModalContext: () => ({
    closeModal: vi.fn(),
    showModal: mocks.confirm,
    transitionModal: mocks.confirm,
    hasActiveCloseGuard: false,
    setCloseGuard: vi.fn(),
  }),
  useShowModal: () => mocks.confirm,
  useTransitionModal: () => mocks.confirm,
  showModal: mocks.confirm,
}));

vi.mock('@renderer/lib/stores/app-state', () => {
  const appState = {
    dependencies: {
      agentStatuses: {
        codex: { status: 'available' },
      },
    },
  };
  return {
    appState,
    sidebarStore: {},
    workspaceStore: {},
    agentRuntimeStore: {},
  };
});

function findButton(host: ParentNode, text: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.includes(text)
  );
}

describe('AutomationMainPanel', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.create.mockReset();
    mocks.update.mockReset();
    mocks.remove.mockReset();
    mocks.run.mockReset();
    mocks.navigate.mockReset();
    mocks.openTaskTarget.mockReset();
    mocks.confirm.mockReset();
    mocks.toast.mockReset();
    host = document.createElement('div');
    host.style.width = '1200px';
    host.style.height = '900px';
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

  it('keeps run history informational and places session continuation in the action bar', async () => {
    const { AutomationMainPanel } = await import('@renderer/features/automation/automation-view');
    await act(async () => root.render(createElement(AutomationMainPanel)));

    expect(host.textContent).toContain(fixtures.activeAutomation.title);
    expect(host.textContent).toContain(fixtures.activeAutomation.prompt);
    expect(host.textContent).toContain(fixtures.pausedAutomation.title);
    expect(host.textContent).toContain(fixtures.codexAutomation.title);
    expect(host.textContent).not.toContain('Aug');
    expect(findButton(host, 'automation.filters.all')?.getAttribute('aria-pressed')).toBe('true');
    expect(host.textContent).not.toContain('automation.recentRuns.title');

    const activeCard = Array.from(host.querySelectorAll('article')).find((card) =>
      card.textContent?.includes(fixtures.activeAutomation.title)
    );
    const recentRunButton = activeCard?.querySelector<HTMLButtonElement>(
      'footer button[aria-label="automation.card.openLastRun"]'
    );

    expect(
      activeCard?.firstElementChild?.querySelector('[aria-label="automation.card.openLastRun"]')
    ).toBeNull();
    expect(recentRunButton?.textContent).toContain('automation.card.continueSession');
    await act(async () => recentRunButton?.click());
    expect(mocks.openTaskTarget).toHaveBeenCalledWith(
      {
        projectId: INTERNAL_PROJECT_ID,
        taskId: fixtures.recentRun.taskId,
        conversationId: fixtures.recentRun.conversationId,
      },
      mocks.navigate
    );
  });

  it('keeps filters and the primary run action visible without hover', async () => {
    const { AutomationMainPanel } = await import('@renderer/features/automation/automation-view');
    await act(async () => root.render(createElement(AutomationMainPanel)));

    const runButton = findButton(host, 'automation.actions.runNow');
    expect(runButton).toBeTruthy();
    await act(async () => runButton?.click());
    expect(mocks.run).toHaveBeenCalledWith(fixtures.activeAutomation.id, expect.any(Object));

    const pausedFilter = findButton(host, 'automation.filters.paused');
    await act(async () => pausedFilter?.click());
    const visibleCards = Array.from(host.querySelectorAll('article'));
    expect(visibleCards).toHaveLength(2);
    expect(host.textContent).toContain(fixtures.pausedAutomation.title);
    expect(host.textContent).toContain(fixtures.codexAutomation.title);
    expect(host.textContent).not.toContain(fixtures.activeAutomation.title);
  });

  it('opens the product-oriented creation editor from the page action', async () => {
    const { AutomationMainPanel } = await import('@renderer/features/automation/automation-view');
    await act(async () => root.render(createElement(AutomationMainPanel)));

    const createButton = findButton(host, 'automation.new');
    await act(async () => createButton?.click());

    expect(host.textContent).toContain('automation.editor.createTitle');
    expect(host.textContent).toContain('automation.editor.executionTitle');
    expect(host.textContent).toContain('automation.form.promptHint');
    expect(host.textContent).toContain('automation.form.manualHint');
  });

  it('keeps Codex-synced automations visibly read-only', async () => {
    const { AutomationMainPanel } = await import('@renderer/features/automation/automation-view');
    await act(async () => root.render(createElement(AutomationMainPanel)));

    const codexCard = Array.from(host.querySelectorAll('article')).find((card) =>
      card.textContent?.includes(fixtures.codexAutomation.title)
    );
    expect(codexCard?.textContent).toContain('automation.source.codexManaged');
    expect(codexCard?.textContent).toContain('automation.source.readOnly');
    expect(codexCard?.querySelector('footer')).not.toBeNull();
    expect(findButton(codexCard as HTMLElement, 'automation.actions.runNow')).toBeUndefined();
    expect(codexCard?.querySelector('button[aria-label^="automation.actions.more"]')).toBeNull();
  });

  it('uses one card structure while keeping management ownership explicit', async () => {
    const { AutomationMainPanel } = await import('@renderer/features/automation/automation-view');
    await act(async () => root.render(createElement(AutomationMainPanel)));

    const cards = Array.from(host.querySelectorAll('article'));
    expect(cards).toHaveLength(3);
    expect(cards.every((card) => card.querySelector('footer'))).toBe(true);
    expect(cards[0]?.textContent).toContain(fixtures.activeAutomation.title);
    expect(cards[1]?.textContent).toContain('automation.source.yodaManaged');
    expect(cards[2]?.textContent).toContain(fixtures.codexAutomation.title);
  });
});
