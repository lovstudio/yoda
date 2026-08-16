import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiInvocationLogRecord } from '@shared/ai-logs';
import { AiLogsPanel } from '@renderer/features/ai-logs/components/AiLogsPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  copyTextToClipboard: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

const fixture = vi.hoisted(
  (): AiInvocationLogRecord => ({
    id: 'log-1',
    purpose: 'interactive-session',
    mode: 'interactive',
    runtime: 'codex',
    model: 'gpt-5.6-luna',
    command: `codex -c notify=["bash","-c","${'curl http://127.0.0.1/hook; '.repeat(12)}","_"] --dangerously-bypass-approvals-and-sandbox -c developer_instructions="${'Follow the project instructions. '.repeat(12)}" -c model_provider="zenmux" -H "Authorization: Bearer sk-secret" ZENMUX_API_KEY=sk-secret-2`,
    prompt: 'PRIVATE PROMPT BODY',
    output: 'PRIVATE OUTPUT BODY',
    status: 'failed',
    error: 'Invalid request: token=raw-secret',
    metadata: {
      conversationId: 'conversation-1',
      authProvider: 'yoda-maas',
      apiKey: 'metadata-secret',
    },
    startedAt: '2026-08-12T03:27:30.000Z',
    finishedAt: '2026-08-12T03:27:34.000Z',
    durationMs: 4_000,
  })
);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; label?: string; defaultValue?: string }) => {
      if (key === 'common.copyDebugInfo') return 'Copy debug info';
      if (key === 'common.debugInfoCopied') return 'Debug info copied';
      if (key === 'common.copyFailed') return 'Copy failed';
      if (key === 'aiLogs.command') return 'Command';
      if (key === 'aiLogs.prompt') return 'Prompt';
      if (key === 'aiLogs.output') return 'Output';
      if (key === 'aiLogs.error') return 'Error';
      if (key === 'aiLogs.copyDetail') return `Copy ${options?.label ?? ''}`;
      if (key === 'aiLogs.detailCopied') return `${options?.label ?? ''} copied`;
      if (key === 'aiLogs.expandDetail') return `Expand ${options?.label ?? ''}`;
      if (key === 'aiLogs.collapseDetail') return `Collapse ${options?.label ?? ''}`;
      if (key === 'aiLogs.detailActions') return `${options?.label ?? ''} actions`;
      if (key === 'aiLogs.commandValueCollapsed') return `<collapsed · ${options?.count} chars>`;
      if (key === 'aiLogs.showRawCommand') return 'Show raw command';
      if (key === 'aiLogs.showCompactCommand') return 'Show compact command';
      return options?.defaultValue ?? key;
    },
  }),
}));

vi.mock('@renderer/features/ai-logs/use-ai-logs', () => ({
  useAiLogs: () => ({ data: [fixture], isLoading: false }),
  useClearAiLogs: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  copyTextToClipboard: mocks.copyTextToClipboard,
  useToast: () => ({
    toast: {
      success: mocks.toastSuccess,
      error: mocks.toastError,
    },
  }),
}));

describe('AiLogsPanel', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    mocks.copyTextToClipboard.mockReset();
    mocks.copyTextToClipboard.mockResolvedValue(undefined);
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(AiLogsPanel)));
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-testid="ai-log-row"]')?.click()
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.querySelectorAll('[data-base-ui-portal]').forEach((portal) => portal.remove());
    host.remove();
  });

  it('copies redacted per-log debug information without prompt or output bodies', async () => {
    const copyButton = host.querySelector<HTMLButtonElement>('[aria-label="Copy debug info"]');
    expect(copyButton).not.toBeNull();
    await act(async () => copyButton?.click());

    expect(mocks.copyTextToClipboard).toHaveBeenCalledOnce();
    const copied = mocks.copyTextToClipboard.mock.calls[0]?.[0] as string;
    const payload = JSON.parse(copied) as {
      schema: string;
      log: { metadata: Record<string, string>; command: string; error: string };
      omittedContent: { promptChars: number; outputChars: number };
    };
    expect(payload.schema).toBe('yoda-ai-log-debug/v1');
    expect(payload.log.metadata.conversationId).toBe('conversation-1');
    expect(payload.log.metadata.apiKey).toBe('[REDACTED]');
    expect(payload.log.command).toContain('model_provider="zenmux"');
    expect(payload.log.command).toContain('[REDACTED]');
    expect(payload.log.error).toContain('[REDACTED]');
    expect(payload.omittedContent).toEqual({
      promptChars: fixture.prompt?.length,
      outputChars: fixture.output?.length,
    });
    expect(copied).not.toContain('sk-secret');
    expect(copied).not.toContain('raw-secret');
    expect(copied).not.toContain('metadata-secret');
    expect(copied).not.toContain('PRIVATE PROMPT BODY');
    expect(copied).not.toContain('PRIVATE OUTPUT BODY');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Debug info copied');
  });

  it('keeps long details compact and supports expanding and copying one block', async () => {
    const command = host.querySelector<HTMLPreElement>('pre[aria-label="Command"]');
    expect(command).not.toBeNull();
    expect(command?.classList.contains('max-h-32')).toBe(true);
    expect(command?.classList.contains('break-words')).toBe(true);
    expect(command?.classList.contains('break-all')).toBe(false);
    expect(command?.textContent).toContain('notify=<collapsed ·');
    expect(command?.textContent).toContain('developer_instructions=<collapsed ·');
    expect(command?.textContent).toContain('\n  --dangerously-bypass-approvals-and-sandbox');
    expect(command?.textContent).not.toContain('curl http://127.0.0.1/hook');

    const rawButton = host.querySelector<HTMLButtonElement>('[aria-label="Show raw command"]');
    expect(rawButton?.getAttribute('aria-pressed')).toBe('false');
    await act(async () => rawButton?.click());
    expect(command?.textContent).toBe(fixture.command);
    expect(
      host
        .querySelector<HTMLButtonElement>('[aria-label="Show compact command"]')
        ?.getAttribute('aria-pressed')
    ).toBe('true');

    const expandButton = host.querySelector<HTMLButtonElement>('[aria-label="Expand Command"]');
    expect(expandButton?.getAttribute('aria-expanded')).toBe('false');
    await act(async () => expandButton?.click());
    expect(command?.className).toContain('max-h-[min(60vh,40rem)]');
    expect(
      host
        .querySelector<HTMLButtonElement>('[aria-label="Collapse Command"]')
        ?.getAttribute('aria-expanded')
    ).toBe('true');

    const copyButton = host.querySelector<HTMLButtonElement>('[aria-label="Copy Command"]');
    await act(async () => copyButton?.click());
    expect(mocks.copyTextToClipboard).toHaveBeenLastCalledWith(fixture.command);
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Command copied');
  });
});
