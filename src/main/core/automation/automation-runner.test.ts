import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Automation } from '@shared/automation';
import {
  agentSessionStatusChangedChannel,
  type AgentSessionStatusChanged,
} from '@shared/events/agentEvents';
import type { CreateTaskParams } from '@shared/tasks';
import { AutomationRunner } from './automation-runner';

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  eventListeners: new Map<string, (event: unknown) => void>(),
  finishRun: vi.fn(),
  finishRunningRunForTask: vi.fn(),
  getAutomation: vi.fn(),
  hasRunningRun: vi.fn(),
  setLastRunAt: vi.fn(),
  startRun: vi.fn(),
}));

vi.mock('@main/core/tasks/operations/createTask', () => ({
  createTask: mocks.createTask,
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    })),
  },
}));

vi.mock('@main/lib/events', () => ({
  events: {
    on: vi.fn((channel: { name: string }, listener: (event: unknown) => void): (() => void) => {
      mocks.eventListeners.set(channel.name, listener);
      return vi.fn();
    }),
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    warn: vi.fn(),
  },
}));

vi.mock('./automation-service', () => ({
  automationService: {
    finishRun: mocks.finishRun,
    finishRunningRunForTask: mocks.finishRunningRunForTask,
    get: mocks.getAutomation,
    hasRunningRun: mocks.hasRunningRun,
    setLastRunAt: mocks.setLastRunAt,
    startRun: mocks.startRun,
  },
}));

const automation: Automation = {
  id: 'automation-1',
  source: 'yoda',
  title: 'Daily check',
  workspaceName: 'Drafts',
  prompt: 'Check the current status',
  runtime: 'codex',
  scheduleLabel: '',
  status: 'active',
  triggerKind: 'cron',
  cronExpr: '0 10 * * *',
  timezone: 'Asia/Shanghai',
  projectId: null,
  nextRunAt: null,
  lastRunAt: null,
  createdAt: '2026-07-31T00:00:00.000Z',
  updatedAt: '2026-07-31T00:00:00.000Z',
};

describe('AutomationRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.eventListeners.clear();
    mocks.getAutomation.mockResolvedValue(automation);
    mocks.hasRunningRun.mockResolvedValue(false);
    mocks.startRun.mockResolvedValue('run-1');
    mocks.finishRun.mockResolvedValue(undefined);
    mocks.finishRunningRunForTask.mockResolvedValue(undefined);
    mocks.setLastRunAt.mockResolvedValue(undefined);
  });

  it('persists task correlation before launch and survives an early completion event', async () => {
    let createParams: CreateTaskParams | undefined;
    mocks.createTask.mockImplementation(async (params: CreateTaskParams) => {
      createParams = params;
      const listener = mocks.eventListeners.get(agentSessionStatusChangedChannel.name);
      listener?.({
        projectId: params.projectId,
        taskId: params.id,
        conversationId: params.initialConversation?.id ?? 'conversation-1',
        status: 'completed',
      } satisfies AgentSessionStatusChanged);
      return { success: true, data: { task: {} } };
    });
    const runner = new AutomationRunner();
    runner.initialize();

    await runner.fire(automation.id, 'manual');

    expect(createParams?.initialConversation?.executionMode).toBe('automation');
    expect(mocks.startRun).toHaveBeenCalledWith(automation.id, 'manual', createParams?.id);
    expect(mocks.finishRunningRunForTask).toHaveBeenCalledWith(createParams?.id, 'success');
    expect(mocks.startRun.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.finishRunningRunForTask.mock.invocationCallOrder[0]
    );
  });

  it('records an overlapping invocation as skipped without starting another task', async () => {
    mocks.hasRunningRun.mockResolvedValue(true);
    mocks.startRun.mockResolvedValue('skipped-run');
    const runner = new AutomationRunner();
    runner.initialize();

    await runner.fire(automation.id, 'cron');

    expect(mocks.startRun).toHaveBeenCalledWith(automation.id, 'cron');
    expect(mocks.finishRun).toHaveBeenCalledWith(
      'skipped-run',
      'skipped',
      'Previous run still in progress.'
    );
    expect(mocks.createTask).not.toHaveBeenCalled();
  });
});
