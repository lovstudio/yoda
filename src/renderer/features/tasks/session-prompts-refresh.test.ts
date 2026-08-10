import { readFileSync } from 'node:fs';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import {
  resolveSessionConversation,
  SESSION_PROMPTS_IDLE_REFRESH_MS,
  SESSION_PROMPTS_REFRESH_MS,
  sessionConversationQueryOptions,
  startVisibleSessionRefresh,
} from './session-prompts';

const mocks = vi.hoisted(() => ({
  getClaudeSessionConversation: vi.fn(),
  getClaudeSessionContext: vi.fn(),
  getCodexSessionConversation: vi.fn(),
  getCodexSessionContext: vi.fn(),
  getCohubSessionContext: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({ rpc: { conversations: mocks } }));

const codexConversation: Conversation = {
  id: 'conversation-1',
  projectId: 'project-1',
  taskId: 'task-1',
  runtimeId: 'codex',
  title: 'Fix polling',
  createdAt: '2026-08-09T00:00:00.000Z',
  lastInteractedAt: null,
  isInitialConversation: true,
};

describe('session conversation polling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClaudeSessionConversation.mockResolvedValue(null);
    mocks.getCodexSessionConversation.mockResolvedValue(null);
    mocks.getCohubSessionContext.mockResolvedValue(null);
  });

  it('coalesces duplicate consumers through one React Query request', async () => {
    mocks.getCodexSessionConversation.mockResolvedValue({
      prompts: [{ id: 'prompt-1', text: 'Fix it', timestamp: null }],
      messages: [],
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const input = {
      active: true,
      conversation: codexConversation,
      cwd: '/repo',
      runtimeStatus: 'working',
    } as const;

    const [first, second] = await Promise.all([
      queryClient.fetchQuery(sessionConversationQueryOptions(input)),
      queryClient.fetchQuery(sessionConversationQueryOptions(input)),
    ]);

    expect(first).toEqual(second);
    expect(mocks.getCodexSessionConversation).toHaveBeenCalledOnce();
    expect(mocks.getCodexSessionContext).not.toHaveBeenCalled();
    queryClient.clear();
  });

  it('uses the same cache key while making a collapsed or hidden consumer passive', () => {
    const active = sessionConversationQueryOptions({
      active: true,
      conversation: codexConversation,
      cwd: '/repo',
      runtimeStatus: 'working',
    });
    const collapsed = sessionConversationQueryOptions({
      active: false,
      conversation: codexConversation,
      cwd: '/repo',
      runtimeStatus: 'idle',
    });
    const idle = sessionConversationQueryOptions({
      active: true,
      conversation: codexConversation,
      cwd: '/repo',
      runtimeStatus: 'idle',
    });

    expect(collapsed.queryKey).toEqual(active.queryKey);
    expect(idle.queryKey).toEqual(active.queryKey);
    expect(active.refetchInterval).toBe(SESSION_PROMPTS_REFRESH_MS);
    expect(idle.refetchInterval).toBe(SESSION_PROMPTS_IDLE_REFRESH_MS);
    expect(active.refetchIntervalInBackground).toBe(false);
    expect(collapsed.enabled).toBe(false);
    expect(collapsed.refetchInterval).toBe(false);

    const sessionPanelSource = readFileSync(
      new URL('./view/session-panel.tsx', import.meta.url),
      'utf8'
    );
    expect(sessionPanelSource).toContain("active={panelActive && openSection === 'conversation'}");
    expect(sessionPanelSource).toContain('const prompts = useSessionPrompts(active);');
    expect(sessionPanelSource).not.toContain('const prompts = useSessionPrompts(true);');
  });

  it('uses the lightweight Claude conversation RPC instead of full harness context', async () => {
    const conversation: Conversation = { ...codexConversation, runtimeId: 'claude' };
    mocks.getClaudeSessionConversation.mockResolvedValue({ prompts: [], messages: [] });

    await resolveSessionConversation(conversation, '/repo');

    expect(mocks.getClaudeSessionConversation).toHaveBeenCalledWith('/repo', conversation.id);
    expect(mocks.getClaudeSessionContext).not.toHaveBeenCalled();
  });
});

describe('startVisibleSessionRefresh', () => {
  it('pauses while hidden and refreshes immediately when visibility returns', async () => {
    vi.useFakeTimers();
    let visible = false;
    let onVisibilityChange: (() => void) | undefined;
    const load = vi.fn(async () => {});
    const stop = startVisibleSessionRefresh(load, {
      isVisible: () => visible,
      subscribeVisibility: (listener) => {
        onVisibilityChange = listener;
        return () => {
          onVisibilityChange = undefined;
        };
      },
    });

    await vi.advanceTimersByTimeAsync(SESSION_PROMPTS_REFRESH_MS * 2);
    expect(load).not.toHaveBeenCalled();

    visible = true;
    onVisibilityChange?.();
    await Promise.resolve();
    expect(load).toHaveBeenCalledOnce();

    stop();
    vi.useRealTimers();
  });

  it('skips interval ticks while a previous transcript scan is still running', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const load = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const stop = startVisibleSessionRefresh(load, {
      isVisible: () => true,
      subscribeVisibility: () => () => {},
    });
    await Promise.resolve();
    expect(load).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(SESSION_PROMPTS_REFRESH_MS * 3);
    expect(load).toHaveBeenCalledOnce();

    finish();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(SESSION_PROMPTS_REFRESH_MS);
    expect(load).toHaveBeenCalledTimes(2);

    stop();
    vi.useRealTimers();
  });
});
