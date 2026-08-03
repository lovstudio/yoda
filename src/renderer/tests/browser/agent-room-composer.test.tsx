import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomMember } from '@shared/team-room';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  postLeadMessage: vi.fn<(body: string) => Promise<void>>(),
  stopRoom: vi.fn<() => Promise<void>>(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/features/agent-room/agent-room-store', () => ({
  agentRoomStore: {
    postLeadMessage: mocks.postLeadMessage,
    stopRoom: mocks.stopRoom,
  },
}));

vi.mock('@renderer/features/agent-room/feature-workflow-rail', () => ({
  FeatureWorkflowRail: () => null,
}));

vi.mock('@renderer/features/features/feature-navigation', () => ({
  openFeature: vi.fn(),
}));

vi.mock('@renderer/features/features/use-features', () => ({
  useFeature: () => ({ data: null, isLoading: false }),
}));

vi.mock('@renderer/features/tasks/task-view-context', () => ({
  useRequireProvisionedTask: () => {
    throw new Error('Task view context is not used by AgentRoomComposer');
  },
}));

const member: RoomMember = {
  id: 'member-1',
  roomId: 'room-1',
  conversationId: null,
  handle: 'xiaoming',
  displayName: '小明',
  icon: '',
  role: 'implementer',
  runtime: 'codex',
  systemPrompt: '',
  skillSelection: null,
  autoApprove: false,
  accent: 'slate',
  status: 'idle',
  createdAt: '2026-07-30T00:00:00.000Z',
};

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function pressEnter(textarea: HTMLTextAreaElement, isComposing = false): void {
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  Object.defineProperty(event, 'isComposing', { value: isComposing });
  textarea.dispatchEvent(event);
}

describe('AgentRoomComposer', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.postLeadMessage.mockResolvedValue();
    mocks.stopRoom.mockResolvedValue();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  async function renderComposer(): Promise<HTMLTextAreaElement> {
    const { AgentRoomComposer } = await import('@renderer/features/agent-room/agent-room-panel');
    await act(async () => {
      root.render(createElement(AgentRoomComposer, { members: [member] }));
    });
    const textarea = host.querySelector('textarea');
    if (!textarea) throw new Error('Expected the agent-room composer textarea');
    return textarea;
  }

  it('输入法组合态按 Enter 时既不发送消息，也不误选建议', async () => {
    const textarea = await renderComposer();

    await act(async () => setTextareaValue(textarea, '@x'));
    expect(host.textContent).toContain('@xiaoming');

    await act(async () => pressEnter(textarea, true));

    expect(mocks.postLeadMessage).not.toHaveBeenCalled();
    expect(textarea.value).toBe('@x');
  });

  it('非组合态按 Enter 仍正常发送消息', async () => {
    const textarea = await renderComposer();

    await act(async () => setTextareaValue(textarea, '西'));
    await act(async () => pressEnter(textarea));

    expect(mocks.postLeadMessage).toHaveBeenCalledOnce();
    expect(mocks.postLeadMessage).toHaveBeenCalledWith('西');
    expect(textarea.value).toBe('');
  });
});
