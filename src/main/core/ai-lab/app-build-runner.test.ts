import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunState } from '@shared/events/agent-run-state';
import { AiLabAppBuildRunner } from './app-build-runner';
import { scaffoldAiLabAppProject } from './app-project-files';
import { AiLabAppStore } from './app-store';
import { AiLabBuildJobStore } from './build-job-store';

const mocks = vi.hoisted(() => ({
  listener: null as ((state: RunState) => void) | null,
  emit: vi.fn(),
  projectPath: '/project',
  status: 'idle' as RunState['status'],
}));

vi.mock('@main/core/conversations/agent-session-runtime', () => ({
  agentSessionRuntimeStore: {
    subscribe: vi.fn((_session, listener: (state: RunState) => void) => {
      mocks.listener = listener;
      return vi.fn();
    }),
    getStatus: vi.fn(() => mocks.status),
  },
}));
vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: { getProject: vi.fn(() => ({ repoPath: mocks.projectPath })) },
}));
vi.mock('@main/lib/events', () => ({ events: { emit: mocks.emit } }));

const directories: string[] = [];

beforeEach(() => {
  mocks.listener = null;
  mocks.emit.mockReset();
  mocks.projectPath = '/project';
  mocks.status = 'idle';
});

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe('AiLabAppBuildRunner', () => {
  it('registers the checked project artifact without reading Agent chat output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'yoda-ai-lab-runner-'));
    directories.push(directory);
    mocks.projectPath = directory;
    await writeReadyBuild(directory, 'Timer', 'A focused timer');
    const jobs = new AiLabBuildJobStore(join(directory, 'jobs.json'));
    const apps = new AiLabAppStore(join(directory, 'apps.json'));
    const runner = new AiLabAppBuildRunner(jobs, apps);

    await runner.prepare({
      projectKind: 'app',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      prompt: 'Build a timer',
      runtimeId: 'amp',
      model: null,
      createdAt: '2026-07-18T00:00:00.000Z',
    });
    completeAgentTurn();
    await vi.waitFor(
      () =>
        expect(mocks.emit).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'ai-lab:app-created' }),
          expect.objectContaining({ taskId: 'task-1', appName: 'Timer' })
        ),
      { timeout: 1_000 }
    );

    const [created] = await apps.list();
    expect(created).toMatchObject({
      name: 'Timer',
      html: '',
      runtimeKind: 'react-vite',
      projectKind: 'app',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      runtimeId: 'amp',
    });
    await vi.waitFor(async () => expect(await jobs.list()).toEqual([]));

    await writeReadyBuild(directory, 'Timer Plus', 'A timer with laps');
    mocks.emit.mockReset();
    await runner.prepare({
      appId: created?.id,
      projectKind: 'app',
      projectId: 'project-1',
      taskId: 'task-2',
      conversationId: 'conversation-2',
      prompt: 'Add laps',
      runtimeId: 'amp',
      model: null,
      createdAt: '2026-07-18T01:00:00.000Z',
    });
    completeAgentTurn();
    await vi.waitFor(
      () =>
        expect(mocks.emit).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'ai-lab:app-updated' }),
          expect.objectContaining({ appName: 'Timer Plus' })
        ),
      { timeout: 1_000 }
    );
    expect(await apps.list()).toEqual([
      expect.objectContaining({
        id: created?.id,
        name: 'Timer Plus',
        taskId: 'task-2',
        conversationId: 'conversation-2',
      }),
    ]);
  });

  it('restores persisted pending build tracking after restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'yoda-ai-lab-runner-'));
    directories.push(directory);
    mocks.projectPath = directory;
    await writeReadyBuild(directory, 'Recovered', 'Recovered from a pending build');
    const jobs = new AiLabBuildJobStore(join(directory, 'jobs.json'));
    await jobs.put({
      projectKind: 'app',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      prompt: 'Build a timer',
      runtimeId: 'claude',
      createdAt: '2026-07-18T00:00:00.000Z',
    });
    const apps = new AiLabAppStore(join(directory, 'apps.json'));

    const runner = new AiLabAppBuildRunner(jobs, apps);
    await runner.initialize();
    expect(mocks.listener).not.toBeNull();
    completeAgentTurn();

    await vi.waitFor(() => expect(mocks.emit).toHaveBeenCalled(), { timeout: 1_000 });
    expect(await apps.list()).toEqual([
      expect.objectContaining({ name: 'Recovered', runtimeKind: 'react-vite' }),
    ]);
    await vi.waitFor(async () => expect(await jobs.list()).toEqual([]), { timeout: 1_000 });
  });
});

function completeAgentTurn(): void {
  mocks.listener?.({
    status: 'completed',
    seen: false,
    pendingAction: null,
    lastForceWorkingAt: 0,
    updatedAt: Date.now(),
  });
}

async function writeReadyBuild(
  directory: string,
  name: string,
  description: string
): Promise<void> {
  await scaffoldAiLabAppProject(directory, name);
  await writeFile(
    join(directory, '.yoda', 'app.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        template: 'react-vite',
        templateVersion: 1,
        status: 'ready',
        name,
        description,
        capabilities: [],
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  await mkdir(join(directory, 'dist'), { recursive: true });
  await writeFile(join(directory, 'dist', 'index.html'), '<!doctype html>', 'utf8');
}
