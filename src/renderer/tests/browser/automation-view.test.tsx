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
  setSessionHealthEnabled: vi.fn(),
  upsertSessionTarget: vi.fn(),
  removeSessionTarget: vi.fn(),
  runSessionTarget: vi.fn(),
  resumeSessionTarget: vi.fn(),
  focusSessionHandoff: vi.fn(),
  navigate: vi.fn(),
  openTaskTarget: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
  copyTextToClipboard: vi.fn(),
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
  const makeSessionTarget = (id: string, status: string, enabled = true) => ({
    id,
    name: `Session ${id}`,
    url: `https://example.com/${id}`,
    enabled,
    intervalMinutes: 15,
    loginUrlPatterns: ['/login'],
    loginTitlePatterns: ['Sign in'],
    humanUrlPatterns: [],
    humanTitlePatterns: [],
    status,
    lastCheckedAt: '2026-08-11T12:00:00.000Z',
    consecutiveHealthyChecks: status === 'fresh' ? 4 : 0,
    lastFreshAt: status === 'fresh' ? '2026-08-11T12:00:00.000Z' : null,
    nextCheckAt: '2026-08-11T12:15:00.000Z',
    lastError: null,
    finalUrl: `https://example.com/${id}`,
    handoffUrl: status === 'auth_required' ? 'ego://task-space/session-health' : null,
    ownership: status === 'auth_required' ? 'agentDelegatedToUser' : 'agent',
    taskSpaceId: 42,
  });
  const sessionTargets = [
    makeSessionTarget('fresh', 'fresh'),
    makeSessionTarget('login', 'auth_required'),
    makeSessionTarget('handoff', 'needs_human'),
    makeSessionTarget('network', 'network_error'),
    makeSessionTarget('paused', 'unknown', false),
  ];
  const sessionHealth = {
    config: {
      version: 1 as const,
      enabled: true,
      targets: sessionTargets.map(
        ({
          status: _status,
          lastCheckedAt: _lastCheckedAt,
          consecutiveHealthyChecks: _consecutiveHealthyChecks,
          lastFreshAt: _lastFreshAt,
          nextCheckAt: _nextCheckAt,
          lastError: _lastError,
          finalUrl: _finalUrl,
          handoffUrl: _handoffUrl,
          ownership: _ownership,
          taskSpaceId: _taskSpaceId,
          ...target
        }) => target
      ),
    },
    targets: sessionTargets,
    statuses: {},
    attention: {
      targetId: 'login',
      targetName: 'Session login',
      state: 'auth_required' as const,
      title: 'Sign-in needed',
      message: 'Finish sign-in in Ego.',
      at: '2026-08-11T12:00:00.000Z',
      handoffUrl: 'ego://task-space/session-health',
    },
    connected: true,
    egoStatus: 'waiting_user' as const,
    taskSpaceName: 'Yoda 会话保活' as const,
    taskSpaceId: 42,
    ownership: 'agentDelegatedToUser' as const,
    checkedAt: '2026-08-11T12:00:00.000Z',
  };
  return {
    activeAutomation,
    pausedAutomation,
    codexAutomation,
    recentRun,
    sessionHealth,
  };
});

const sessionHealthState = vi.hoisted(() => ({ error: null as Error | null }));

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

vi.mock('@renderer/features/automation/use-browser-session-health', () => ({
  useBrowserSessionHealth: () => ({
    data: fixtures.sessionHealth,
    error: sessionHealthState.error,
    isLoading: false,
  }),
  useSetBrowserSessionHealthEnabled: () => ({
    mutate: mocks.setSessionHealthEnabled,
    isPending: false,
    variables: undefined,
  }),
  useUpsertBrowserSessionHealthTarget: () => ({
    mutate: mocks.upsertSessionTarget,
    isPending: false,
    variables: undefined,
  }),
  useRemoveBrowserSessionHealthTarget: () => ({
    mutate: mocks.removeSessionTarget,
    isPending: false,
    variables: undefined,
  }),
  useRunBrowserSessionHealthTarget: () => ({
    mutate: mocks.runSessionTarget,
    isPending: false,
    variables: undefined,
  }),
  useResumeBrowserSessionHealthAfterLogin: () => ({
    mutate: mocks.resumeSessionTarget,
    isPending: false,
    variables: undefined,
  }),
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
  toast: mocks.toast,
  copyTextToClipboard: mocks.copyTextToClipboard,
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    browserSessionHealth: {
      focusHandoff: mocks.focusSessionHandoff,
    },
  },
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
    mocks.setSessionHealthEnabled.mockReset();
    mocks.upsertSessionTarget.mockReset();
    mocks.removeSessionTarget.mockReset();
    mocks.runSessionTarget.mockReset();
    mocks.resumeSessionTarget.mockReset();
    mocks.focusSessionHandoff.mockReset().mockResolvedValue(undefined);
    mocks.navigate.mockReset();
    mocks.openTaskTarget.mockReset();
    mocks.confirm.mockReset();
    mocks.toast.mockReset();
    mocks.copyTextToClipboard.mockReset();
    mocks.copyTextToClipboard.mockResolvedValue(undefined);
    sessionHealthState.error = null;
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

  it('keeps rows concise until their accordion is opened, then exposes details and actions', async () => {
    const { AutomationMainPanel } = await import('@renderer/features/automation/automation-view');
    await act(async () => root.render(createElement(AutomationMainPanel)));

    expect(host.textContent).toContain(fixtures.activeAutomation.title);
    expect(host.textContent).toContain(fixtures.pausedAutomation.title);
    expect(host.textContent).toContain(fixtures.codexAutomation.title);
    expect(findButton(host, 'automation.filters.all')?.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('[data-schedule-timeline]')?.textContent).toContain(
      'automation.timeline.title'
    );

    const activeCard = Array.from(host.querySelectorAll('article')).find((card) =>
      card.textContent?.includes(fixtures.activeAutomation.title)
    );
    const trigger = activeCard?.querySelector<HTMLButtonElement>(
      '[data-slot="collapsible-trigger"]'
    );

    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(activeCard?.querySelector('[data-slot="switch"]')).not.toBeNull();
    expect(findButton(activeCard as HTMLElement, 'automation.actions.runNow')).toBeUndefined();

    await act(async () => trigger?.click());

    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    expect(activeCard?.textContent).toContain(fixtures.activeAutomation.prompt);
    expect(activeCard?.textContent).toContain('automation.card.workspace');

    const copyButton = findButton(activeCard as HTMLElement, 'automation.actions.copyInfo');
    await act(async () => copyButton?.click());
    expect(mocks.copyTextToClipboard).toHaveBeenCalledOnce();
    expect(mocks.copyTextToClipboard.mock.calls[0]?.[0]).toContain(fixtures.activeAutomation.title);
    expect(mocks.copyTextToClipboard.mock.calls[0]?.[0]).toContain(
      fixtures.activeAutomation.cronExpr
    );

    const recentRunButton = activeCard?.querySelector<HTMLButtonElement>(
      'button[aria-label="automation.card.openLastRun"]'
    );
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

  it('keeps filters compact and puts manual execution in the expanded action bar', async () => {
    const { AutomationMainPanel } = await import('@renderer/features/automation/automation-view');
    await act(async () => root.render(createElement(AutomationMainPanel)));

    const activeCard = Array.from(host.querySelectorAll('article')).find((card) =>
      card.textContent?.includes(fixtures.activeAutomation.title)
    );
    const trigger = activeCard?.querySelector<HTMLButtonElement>(
      '[data-slot="collapsible-trigger"]'
    );
    await act(async () => trigger?.click());

    const runButton = findButton(activeCard as HTMLElement, 'automation.actions.runNow');
    expect(runButton).toBeTruthy();
    await act(async () => runButton?.click());
    expect(mocks.run).toHaveBeenCalledWith(fixtures.activeAutomation.id, expect.any(Object));

    const pausedFilter = findButton(host, 'automation.filters.paused');
    await act(async () => pausedFilter?.click());
    const visibleCards = Array.from(host.querySelectorAll('article')).filter(
      (card) => !card.closest('[data-browser-session-health]')
    );
    expect(visibleCards).toHaveLength(2);
    expect(
      visibleCards.some((card) => card.textContent?.includes(fixtures.pausedAutomation.title))
    ).toBe(true);
    expect(
      visibleCards.some((card) => card.textContent?.includes(fixtures.codexAutomation.title))
    ).toBe(true);
    expect(
      visibleCards.some((card) => card.textContent?.includes(fixtures.activeAutomation.title))
    ).toBe(false);
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

  it('keeps Codex-synced automations visibly read-only after expansion', async () => {
    const { AutomationMainPanel } = await import('@renderer/features/automation/automation-view');
    await act(async () => root.render(createElement(AutomationMainPanel)));

    const codexCard = Array.from(host.querySelectorAll('article')).find((card) =>
      card.textContent?.includes(fixtures.codexAutomation.title)
    );
    const trigger = codexCard?.querySelector<HTMLButtonElement>(
      '[data-slot="collapsible-trigger"]'
    );
    const codexSwitch = codexCard?.querySelector('[data-slot="switch"]');

    expect(codexSwitch?.hasAttribute('data-disabled')).toBe(true);
    await act(async () => trigger?.click());

    expect(codexCard?.textContent).toContain('automation.source.codexManaged');
    expect(codexCard?.textContent).toContain('automation.source.readOnly');
    expect(findButton(codexCard as HTMLElement, 'automation.actions.runNow')).toBeUndefined();
    expect(codexCard?.querySelector('button[aria-label^="automation.actions.more"]')).toBeNull();
    expect(findButton(codexCard as HTMLElement, 'automation.actions.copyInfo')).toBeTruthy();
  });

  it('shows the main session-health states without exposing row actions inline', async () => {
    const { AutomationMainPanel } = await import('@renderer/features/automation/automation-view');
    await act(async () => root.render(createElement(AutomationMainPanel)));

    const healthCard = host.querySelector('[data-browser-session-health]');
    expect(healthCard?.textContent).toContain('automation.sessionHealth.statuses.fresh');
    expect(healthCard?.textContent).toContain('automation.sessionHealth.statuses.auth_required');
    expect(healthCard?.textContent).toContain('automation.sessionHealth.statuses.needs_human');
    expect(healthCard?.textContent).toContain('automation.sessionHealth.statuses.network_error');
    expect(healthCard?.textContent).toContain('automation.sessionHealth.statuses.paused');

    const freshRow = Array.from(healthCard?.querySelectorAll('article') ?? []).find((row) =>
      row.textContent?.includes('Session fresh')
    );
    expect(findButton(freshRow as HTMLElement, 'automation.sessionHealth.actions.runNow')).toBe(
      undefined
    );
    expect(
      freshRow?.querySelector('button[aria-label^="automation.sessionHealth.actions.more"]')
    ).toBeTruthy();
  });

  it('requires an explicit resume action after the user finishes signing in', async () => {
    const { AutomationMainPanel } = await import('@renderer/features/automation/automation-view');
    await act(async () => root.render(createElement(AutomationMainPanel)));

    const loginRow = Array.from(
      host.querySelectorAll('[data-browser-session-health] article')
    ).find((row) => row.textContent?.includes('Session login'));
    const loginButton = findButton(
      loginRow as HTMLElement,
      'automation.sessionHealth.actions.loginInEgo'
    );
    const resumeButton = findButton(
      loginRow as HTMLElement,
      'automation.sessionHealth.actions.resumeAfterLogin'
    );

    await act(async () => loginButton?.click());
    expect(mocks.focusSessionHandoff).toHaveBeenCalledOnce();
    expect(mocks.resumeSessionTarget).not.toHaveBeenCalled();

    await act(async () => resumeButton?.click());
    expect(mocks.resumeSessionTarget).toHaveBeenCalledWith('login', expect.any(Object));
  });

  it('does not submit a target when Enter follows IME composition', async () => {
    const { AutomationMainPanel } = await import('@renderer/features/automation/automation-view');
    await act(async () => root.render(createElement(AutomationMainPanel)));

    await act(async () => findButton(host, 'automation.sessionHealth.addTarget')?.click());
    const form = host.querySelector<HTMLFormElement>('[data-session-health-editor]');
    const inputs = Array.from(form?.querySelectorAll<HTMLInputElement>('input') ?? []);
    const setInputValue = (input: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };

    await act(async () => {
      setInputValue(inputs[0]!, 'Cloud console');
      setInputValue(inputs[1]!, 'https://example.com/account');
      setInputValue(inputs[2]!, '/login');
      inputs[0]!.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      inputs[0]!.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      inputs[0]!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(mocks.upsertSessionTarget).not.toHaveBeenCalled();
  });

  it('copies debug context from a session-health error', async () => {
    sessionHealthState.error = new Error('Ego fixture disconnected');
    const { AutomationMainPanel } = await import('@renderer/features/automation/automation-view');
    await act(async () => root.render(createElement(AutomationMainPanel)));

    const copyButton = findButton(host, 'automation.sessionHealth.errors.copyDebug');
    await act(async () => copyButton?.click());

    expect(mocks.copyTextToClipboard).toHaveBeenCalledOnce();
    expect(mocks.copyTextToClipboard.mock.calls[0]?.[0]).toContain('Ego fixture disconnected');
    expect(mocks.copyTextToClipboard.mock.calls[0]?.[0]).toContain('get_snapshot');
  });
});
