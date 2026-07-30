import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectLaunchCommand } from '@shared/quick-actions';
import { runProjectLaunchCommand } from './run-project-launch-command';

const mocks = vi.hoisted(() => ({
  getTaskStore: vi.fn(),
  asProvisioned: vi.fn(),
  getTerminalsPaneSize: vi.fn(),
}));

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  getTaskStore: mocks.getTaskStore,
  asProvisioned: mocks.asProvisioned,
}));

vi.mock('@renderer/features/tasks/terminals/terminal-tabs', () => ({
  getTerminalsPaneSize: mocks.getTerminalsPaneSize,
}));

const launchCommand: ProjectLaunchCommand = {
  id: 'package-script:dev',
  label: 'Start locally',
  command: 'pnpm run dev',
  source: 'package.json',
};

describe('runProjectLaunchCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTerminalsPaneSize.mockReturnValue({ cols: 120, rows: 36 });
  });

  it('returns false when there is no provisioned task terminal host', async () => {
    mocks.getTaskStore.mockReturnValue({ state: 'unprovisioned' });
    mocks.asProvisioned.mockReturnValue(undefined);

    await expect(
      runProjectLaunchCommand({
        projectId: 'project-1',
        taskId: 'task-1',
        launchCommand,
      })
    ).resolves.toBe(false);
  });

  it('creates and selects a standard terminal before running the launch command', async () => {
    const setBottomPanelTab = vi.fn();
    const setBottomPanelOpen = vi.fn();
    const setFocusedRegion = vi.fn();
    const setActiveTab = vi.fn();
    const createCommandTerminal = vi.fn().mockResolvedValue({ id: 'terminal-1' });
    const taskStore = { state: 'provisioned' };
    mocks.getTaskStore.mockReturnValue(taskStore);
    mocks.asProvisioned.mockReturnValue({
      taskView: {
        setBottomPanelTab,
        setBottomPanelOpen,
        setFocusedRegion,
        terminalTabs: { setActiveTab },
      },
      terminals: { createCommandTerminal },
    });

    await expect(
      runProjectLaunchCommand({
        projectId: 'project-1',
        taskId: 'task-1',
        launchCommand,
      })
    ).resolves.toBe(true);

    expect(mocks.getTaskStore).toHaveBeenCalledWith('project-1', 'task-1');
    expect(setBottomPanelTab).toHaveBeenCalledWith('terminals', {
      ensureTerminal: false,
    });
    expect(setBottomPanelOpen).toHaveBeenCalledWith(true);
    expect(setFocusedRegion).toHaveBeenCalledWith('bottom');
    expect(createCommandTerminal).toHaveBeenCalledWith({
      command: 'pnpm run dev',
      label: 'Start locally',
      initialSize: { cols: 120, rows: 36 },
    });
    expect(setActiveTab).toHaveBeenCalledWith('terminal-1');
  });
});
