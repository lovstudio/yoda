import { describe, expect, it } from 'vitest';
import { readRuntimeBarSource } from '@renderer/app/runtime-bar/test-helpers/read-bar-source';

describe('Workspace runtime bar Terminal ownership', () => {
  const source = readRuntimeBarSource();

  it('uses the quick-action project/global Terminal as its only button state', () => {
    expect(source).toContain('const workspaceTerminalOpen = workspaceTerminalStore.isOpen;');
    expect(source).toContain('const terminalActive = workspaceTerminalOpen;');
    expect(source).not.toContain(
      'const terminalActive = taskTerminalActive || workspaceTerminalStore.isOpen;'
    );

    const toggleStart = source.indexOf('const toggleTerminal = () => {');
    const toggleEnd = source.indexOf('\n  };', toggleStart);
    const toggleSource = source.slice(toggleStart, toggleEnd);

    expect(toggleSource).toContain(
      'workspaceTerminalStore.toggleForRuntimeBar(activeMountedProjectData)'
    );
    expect(toggleSource).not.toContain('workspaceTerminalStore.close()');
    expect(toggleSource).not.toContain('workspaceTerminalStore.toggleProject');
    expect(toggleSource).not.toContain('workspaceTerminalStore.toggleGlobal');
    expect(toggleSource).not.toContain('setTerminalDrawerOpen');
    expect(toggleSource).not.toContain('taskTerminalVisible');
  });

  it('collapses a task Terminal hidden behind the quick-action Terminal', () => {
    expect(source).toContain(
      'if (!workspaceTerminalOpen || !taskTerminalVisible || !provisionedTask) return;'
    );
    expect(source).toContain('provisionedTask.taskView.setTerminalDrawerOpen(false);');
  });
});
