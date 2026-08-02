import { observable, runInAction } from 'mobx';
import { describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@shared/terminals';
import type { TerminalManagerStore, TerminalStore } from './terminal-manager';
import { TerminalTabViewStore } from './terminal-tab-view-store';

const terminal: Terminal = {
  id: 'terminal-1',
  projectId: 'project-1',
  taskId: 'task-1',
  name: 'Terminal 1',
};

function createResource() {
  const terminals = observable.map<string, TerminalStore>([
    [terminal.id, { data: terminal } as TerminalStore],
  ]);
  const ensureDefaultTerminal = vi.fn(async () => terminal);
  const deleteTerminal = vi.fn(async (id: string) => {
    runInAction(() => terminals.delete(id));
  });
  return {
    manager: {
      terminals,
      ensureDefaultTerminal,
      deleteTerminal,
    } as unknown as TerminalManagerStore,
    terminals,
    ensureDefaultTerminal,
    deleteTerminal,
  };
}

describe('TerminalTabViewStore replacement lifecycle', () => {
  it('does not auto-create when a failed optimistic terminal disappears', async () => {
    const resource = createResource();
    const tabs = new TerminalTabViewStore(resource.manager);

    runInAction(() => resource.terminals.delete(terminal.id));
    await Promise.resolve();

    expect(resource.ensureDefaultTerminal).not.toHaveBeenCalled();
    tabs.dispose();
  });

  it('ensures one replacement after the user deletes the final tab', async () => {
    const resource = createResource();
    const tabs = new TerminalTabViewStore(resource.manager);

    tabs.removeTab(terminal.id);

    await vi.waitFor(() => expect(resource.ensureDefaultTerminal).toHaveBeenCalledTimes(1));
    expect(resource.deleteTerminal).toHaveBeenCalledWith(terminal.id);
    tabs.dispose();
  });

  it('does not ensure a replacement when a delayed delete finishes after disposal', async () => {
    const resource = createResource();
    let finishDelete!: () => void;
    resource.deleteTerminal.mockImplementation(async (id: string) => {
      await new Promise<void>((resolve) => {
        finishDelete = resolve;
      });
      runInAction(() => resource.terminals.delete(id));
    });
    const tabs = new TerminalTabViewStore(resource.manager);

    tabs.removeTab(terminal.id);
    await vi.waitFor(() => expect(resource.deleteTerminal).toHaveBeenCalledWith(terminal.id));
    tabs.dispose();
    finishDelete();
    await vi.waitFor(() => expect(resource.terminals.has(terminal.id)).toBe(false));

    expect(resource.ensureDefaultTerminal).not.toHaveBeenCalled();
  });
});
