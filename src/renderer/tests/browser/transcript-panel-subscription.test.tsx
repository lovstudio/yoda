import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getConversationTranscript: vi.fn(),
  subscribeConversationTranscript: vi.fn(),
  unsubscribeConversationTranscript: vi.fn(),
  eventOff: vi.fn(),
  eventOn: vi.fn(),
  openFile: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: { on: mocks.eventOn },
  rpc: {
    conversations: {
      getConversationTranscript: mocks.getConversationTranscript,
      subscribeConversationTranscript: mocks.subscribeConversationTranscript,
      unsubscribeConversationTranscript: mocks.unsubscribeConversationTranscript,
    },
  },
}));

vi.mock('@renderer/features/tasks/task-view-context', () => ({
  useRequireProvisionedTask: () => ({ taskView: { tabManager: { openFile: mocks.openFile } } }),
}));

vi.mock('@renderer/features/tasks/components/task-menu-session-info', () => ({
  getTaskMenuConversation: () => ({
    id: 'conversation',
    projectId: 'project',
    taskId: 'task',
  }),
}));

vi.mock('@renderer/features/tasks/components/file-actions', () => ({
  FileActionsDropdown: () => null,
}));

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('conversation transcript subscription lifecycle', () => {
  let host: HTMLDivElement;
  let root: Root;
  let transcriptChanged: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    transcriptChanged = undefined;
    mocks.getConversationTranscript.mockResolvedValue({
      filePath: '/tmp/transcript.jsonl',
      totalLines: 1,
      lines: ['{}'],
    });
    mocks.subscribeConversationTranscript.mockResolvedValue(undefined);
    mocks.unsubscribeConversationTranscript.mockResolvedValue(undefined);
    mocks.eventOn.mockImplementation((_channel, listener: () => void) => {
      transcriptChanged = listener;
      return mocks.eventOff;
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('does no file or IPC work while inactive and releases everything on collapse', async () => {
    const { useConversationTranscript } = await import('@renderer/features/tasks/transcript-panel');
    function Probe({ active }: { active: boolean }) {
      useConversationTranscript(active);
      return null;
    }

    await act(async () => root.render(<Probe active={false} />));
    expect(mocks.getConversationTranscript).not.toHaveBeenCalled();
    expect(mocks.subscribeConversationTranscript).not.toHaveBeenCalled();
    expect(mocks.eventOn).not.toHaveBeenCalled();

    await act(async () => root.render(<Probe active />));
    await settle();
    expect(mocks.eventOn).toHaveBeenCalledTimes(1);
    expect(mocks.getConversationTranscript).toHaveBeenCalledWith('project', 'task', 'conversation');
    expect(mocks.subscribeConversationTranscript).toHaveBeenCalledWith(
      'project',
      'task',
      'conversation'
    );
    expect(mocks.eventOn.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.subscribeConversationTranscript.mock.invocationCallOrder[0]
    );
    expect(mocks.subscribeConversationTranscript.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getConversationTranscript.mock.invocationCallOrder[0]
    );

    await act(async () => root.render(<Probe active={false} />));
    await settle();
    expect(mocks.eventOff).toHaveBeenCalledTimes(1);
    expect(mocks.unsubscribeConversationTranscript).toHaveBeenCalledWith(
      'project',
      'task',
      'conversation'
    );
  });

  it('unsubscribes after a deferred subscribe completes during rapid collapse', async () => {
    const pending = deferred<void>();
    mocks.subscribeConversationTranscript.mockReturnValue(pending.promise);
    const { useConversationTranscript } = await import('@renderer/features/tasks/transcript-panel');
    function Probe({ active }: { active: boolean }) {
      useConversationTranscript(active);
      return null;
    }

    await act(async () => root.render(<Probe active />));
    expect(mocks.getConversationTranscript).not.toHaveBeenCalled();
    await act(async () => root.render(<Probe active={false} />));
    expect(mocks.unsubscribeConversationTranscript).not.toHaveBeenCalled();

    pending.resolve();
    await settle();
    expect(mocks.unsubscribeConversationTranscript).toHaveBeenCalledTimes(1);
    expect(mocks.eventOff).toHaveBeenCalledTimes(1);
    expect(mocks.getConversationTranscript).not.toHaveBeenCalled();
  });

  it('coalesces changes during an in-flight read into one trailing refresh', async () => {
    const first = deferred<RawTranscript>();
    const trailing = deferred<RawTranscript>();
    mocks.getConversationTranscript
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(trailing.promise);
    const { useConversationTranscript } = await import('@renderer/features/tasks/transcript-panel');
    function Probe() {
      useConversationTranscript(true);
      return null;
    }

    await act(async () => root.render(<Probe />));
    await settle();
    expect(mocks.getConversationTranscript).toHaveBeenCalledTimes(1);

    act(() => {
      transcriptChanged?.();
      transcriptChanged?.();
      transcriptChanged?.();
    });
    expect(mocks.getConversationTranscript).toHaveBeenCalledTimes(1);

    first.resolve(transcript(1));
    await settle();
    expect(mocks.getConversationTranscript).toHaveBeenCalledTimes(2);

    trailing.resolve(transcript(2));
    await settle();
    expect(mocks.getConversationTranscript).toHaveBeenCalledTimes(2);
  });

  it('drops queued and completed refresh work after cleanup', async () => {
    const pending = deferred<RawTranscript>();
    mocks.getConversationTranscript.mockReturnValue(pending.promise);
    const { useConversationTranscript } = await import('@renderer/features/tasks/transcript-panel');
    function Probe({ active }: { active: boolean }) {
      const feed = useConversationTranscript(active);
      return <span>{feed.transcript?.totalLines ?? 'none'}</span>;
    }

    await act(async () => root.render(<Probe active />));
    await settle();
    expect(mocks.getConversationTranscript).toHaveBeenCalledTimes(1);
    act(() => {
      transcriptChanged?.();
      transcriptChanged?.();
    });

    await act(async () => root.render(<Probe active={false} />));
    pending.resolve(transcript(9));
    await settle();

    expect(mocks.getConversationTranscript).toHaveBeenCalledTimes(1);
    expect(host.textContent).toBe('none');
    expect(mocks.eventOff).toHaveBeenCalledTimes(1);
    expect(mocks.unsubscribeConversationTranscript).toHaveBeenCalledTimes(1);
  });

  it('reads one snapshot when the initial subscription fails', async () => {
    mocks.subscribeConversationTranscript.mockRejectedValue(new Error('watch failed'));
    const { useConversationTranscript } = await import('@renderer/features/tasks/transcript-panel');
    function Probe() {
      useConversationTranscript(true);
      return null;
    }

    await act(async () => root.render(<Probe />));
    await settle();

    expect(mocks.getConversationTranscript).toHaveBeenCalledTimes(1);
    expect(mocks.getConversationTranscript).toHaveBeenCalledWith('project', 'task', 'conversation');
  });
});

interface RawTranscript {
  filePath: string;
  totalLines: number;
  lines: string[];
}

function transcript(totalLines: number): RawTranscript {
  return {
    filePath: '/tmp/transcript.jsonl',
    totalLines,
    lines: ['{}'],
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}
