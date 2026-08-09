import { act, isValidElement, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  clipboardWritePng: vi.fn(),
  domToPng: vi.fn(),
  getLatestReply: vi.fn(),
  openIn: vi.fn(),
  toast: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('modern-screenshot', () => ({ domToPng: mocks.domToPng }));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  useToast: () => ({
    toast: Object.assign(mocks.toast, {
      error: mocks.toastError,
      success: mocks.toastSuccess,
    }),
  }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    app: { clipboardWritePng: mocks.clipboardWritePng, openIn: mocks.openIn },
    sessionShares: { getLatestReply: mocks.getLatestReply },
  },
}));

vi.mock('@renderer/lib/ui/markdown-renderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="screenshot-markdown">{content}</div>
  ),
}));

describe('LatestReplyScreenshotButton', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.domToPng.mockResolvedValue('data:image/png;base64,c2NyZWVuc2hvdA==');
    mocks.clipboardWritePng.mockResolvedValue({
      success: true,
      filePath: '/tmp/yoda/screenshots/responsive-screenshot.png',
    });
    mocks.openIn.mockResolvedValue({ success: true });
    mocks.getLatestReply.mockResolvedValue({
      generatedAt: '2026-08-06T10:00:00.000Z',
      runtimeId: 'codex',
      sessionTitle: 'Responsive screenshot',
      reply: {
        id: 'reply-1',
        role: 'assistant',
        agentPhase: 'final',
        timestamp: '2026-08-06T09:59:00.000Z',
        format: 'markdown',
        content:
          '## Done\n\nThe latest reply.\n\n<oai-mem-citation>internal metadata</oai-mem-citation>',
      },
    });
    host = document.createElement('div');
    host.style.width = '280px';
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('renders a phone-width long image and copies its PNG to the clipboard', async () => {
    const { LatestReplyScreenshotButton } = await import(
      '@renderer/features/tasks/conversations/latest-reply-screenshot'
    );
    await act(async () => {
      root.render(
        <LatestReplyScreenshotButton
          projectId="project-1"
          taskId="task-1"
          conversationId="conversation-1"
        />
      );
    });

    await userEvent.click(host.querySelector('button')!);
    await vi.waitFor(() => expect(mocks.domToPng).toHaveBeenCalledOnce());

    const [card, options] = mocks.domToPng.mock.calls[0] as [HTMLElement, { scale: number }];
    expect(card.className).toContain('w-[360px]');
    expect(card.textContent).toContain('Responsive screenshot');
    expect(card.textContent).toContain('The latest reply.');
    expect(card.textContent).not.toContain('internal metadata');
    expect(card.textContent).not.toContain('<oai-mem-citation>');
    expect(card.textContent).not.toContain('workspaceRuntime.replyScreenshotFooter');
    expect(options.scale).toBe(2);
    expect(mocks.clipboardWritePng).toHaveBeenCalledWith(
      'data:image/png;base64,c2NyZWVuc2hvdA==',
      'Responsive screenshot'
    );
    expect(mocks.toastSuccess).toHaveBeenCalledOnce();

    type ToastNode = ReactElement<{ children?: ReactNode }>;
    type ToastAction = { label: ToastNode; onClick: () => void };
    const [message, toastOptions] = mocks.toastSuccess.mock.calls[0] as [
      ToastNode,
      { description: ToastNode; action: ToastAction; cancel: ToastAction },
    ];
    expect(isValidElement(message)).toBe(true);
    expect(message.props.children).toBe('workspaceRuntime.replyScreenshotCopied');
    expect(toastOptions.description.props.children).toBe('responsive-screenshot.png');
    expect(toastOptions.action.label.props.children).toBe('workspaceRuntime.replyScreenshotOpen');
    expect(toastOptions.cancel.label.props.children).toBe('workspaceRuntime.replyScreenshotReveal');

    await act(async () => toastOptions.action.onClick());
    await vi.waitFor(() =>
      expect(mocks.openIn).toHaveBeenCalledWith({
        app: 'finder',
        isRemote: false,
        path: '/tmp/yoda/screenshots/responsive-screenshot.png',
        reveal: false,
        sshConnectionId: null,
      })
    );
    await act(async () => toastOptions.cancel.onClick());
    await vi.waitFor(() =>
      expect(mocks.openIn).toHaveBeenCalledWith({
        app: 'finder',
        isRemote: false,
        path: '/tmp/yoda/screenshots/responsive-screenshot.png',
        reveal: true,
        sshConnectionId: null,
      })
    );
  });

  it('keeps the current turn explicit when there is no reply yet', async () => {
    mocks.getLatestReply.mockResolvedValue({
      generatedAt: '2026-08-06T10:00:00.000Z',
      runtimeId: 'codex',
      sessionTitle: 'Waiting',
      reply: null,
    });
    const { LatestReplyScreenshotButton } = await import(
      '@renderer/features/tasks/conversations/latest-reply-screenshot'
    );
    await act(async () => {
      root.render(
        <LatestReplyScreenshotButton
          projectId="project-1"
          taskId="task-1"
          conversationId="conversation-1"
        />
      );
    });

    await userEvent.click(host.querySelector('button')!);
    await vi.waitFor(() => expect(mocks.toastError).toHaveBeenCalledOnce());

    expect(mocks.toastError).toHaveBeenCalledWith('workspaceRuntime.replyScreenshotEmpty');
    expect(mocks.domToPng).not.toHaveBeenCalled();
  });

  it('keeps file action failures inspectable', async () => {
    const { LatestReplyScreenshotButton } = await import(
      '@renderer/features/tasks/conversations/latest-reply-screenshot'
    );
    await act(async () => {
      root.render(
        <LatestReplyScreenshotButton
          projectId="project-1"
          taskId="task-1"
          conversationId="conversation-1"
        />
      );
    });

    await userEvent.click(host.querySelector('button')!);
    await vi.waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledOnce());
    mocks.openIn.mockResolvedValueOnce({ success: false, error: 'Screenshot file is missing' });
    const [, toastOptions] = mocks.toastSuccess.mock.calls[0] as [
      ReactElement,
      { action: { onClick: () => void } },
    ];

    await act(async () => toastOptions.action.onClick());
    await vi.waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'workspaceRuntime.replyScreenshotOpenFailed',
          description: 'Screenshot file is missing',
          variant: 'destructive',
          debugInfo: expect.objectContaining({
            filePath: '/tmp/yoda/screenshots/responsive-screenshot.png',
            reveal: false,
            error: expect.any(Error),
          }),
        })
      )
    );
  });
});
