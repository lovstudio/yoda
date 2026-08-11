import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromptToken } from '@renderer/app/prompt-attachment-tokens';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getCatalog: vi.fn(async () => ({ success: true, data: { skills: [] } })),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    app: {
      clipboardWriteText: vi.fn(),
      getHomeDir: vi.fn(),
      openIn: vi.fn(),
      triggerVoiceInput: vi.fn(),
    },
    fs: { listPathCompletions: vi.fn() },
    skills: {
      getCatalog: mocks.getCatalog,
      route: vi.fn(),
    },
  },
}));

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('ComposerPromptInput token geometry', () => {
  let host: HTMLDivElement;
  let queryClient: QueryClient;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    host.remove();
    vi.restoreAllMocks();
  });

  it('does not schedule geometry frames while typing without attachment ranges', async () => {
    const { ComposerPromptInput } = await import('@renderer/app/composer-prompt-input');

    function Harness() {
      const [value, setValue] = useState('');
      const [tokens, setTokens] = useState<PromptToken[]>([]);
      return (
        <QueryClientProvider client={queryClient}>
          <ComposerPromptInput
            value={value}
            onChange={setValue}
            tokens={tokens}
            onTokensChange={setTokens}
            runtimeId={null}
          />
        </QueryClientProvider>
      );
    }

    await act(async () => root.render(<Harness />));
    await act(
      async () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        })
    );

    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    const boundingRects = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    const clientRects = vi.spyOn(Element.prototype, 'getClientRects');
    const textarea = host.querySelector('textarea');
    if (!textarea) throw new Error('Composer textarea is missing');

    for (const value of ['a', 'ab', 'abc', 'abcd']) {
      await act(async () => setTextareaValue(textarea, value));
    }

    expect(textarea.value).toBe('abcd');
    expect(frame).not.toHaveBeenCalled();
    expect(boundingRects).not.toHaveBeenCalled();
    expect(clientRects).not.toHaveBeenCalled();
  });

  it('reuses measured rects until text, token ranges, width, or text style changes', async () => {
    const { createTokenRectMeasurer, findTokenRanges, tokenText } = await import(
      '@renderer/app/prompt-attachment-tokens'
    );
    const token: PromptToken = {
      id: 'file-1',
      kind: 'file',
      label: 'notes.md',
      path: '/tmp/notes.md',
    };
    const textarea = document.createElement('textarea');
    textarea.value = tokenText(token.label);
    document.body.appendChild(textarea);
    const measurer = createTokenRectMeasurer(textarea);
    const boundingRects = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    const clientRects = vi.spyOn(Element.prototype, 'getClientRects');

    const first = measurer.measure(findTokenRanges(textarea.value, [token]));
    const firstLayoutReads = boundingRects.mock.calls.length + clientRects.mock.calls.length;
    const second = measurer.measure(findTokenRanges(textarea.value, [token]));

    expect(firstLayoutReads).toBeGreaterThan(0);
    expect(second).toBe(first);
    expect(boundingRects.mock.calls.length + clientRects.mock.calls.length).toBe(firstLayoutReads);

    textarea.value = `prefix ${tokenText(token.label)}`;
    const third = measurer.measure(findTokenRanges(textarea.value, [token]));
    expect(third).not.toBe(first);
    expect(boundingRects.mock.calls.length + clientRects.mock.calls.length).toBeGreaterThan(
      firstLayoutReads
    );

    measurer.dispose();
    textarea.remove();
  });

  it('keeps token selections atomic after geometry scheduling changes', async () => {
    const { ComposerPromptInput } = await import('@renderer/app/composer-prompt-input');
    const { findTokenRanges, snapSelectionToTokens, tokenText } = await import(
      '@renderer/app/prompt-attachment-tokens'
    );
    const token: PromptToken = {
      id: 'file-1',
      kind: 'file',
      label: 'notes.md',
      path: '/tmp/notes.md',
    };
    const initialValue = `before ${tokenText(token.label)} after`;

    function Harness() {
      const [value, setValue] = useState(initialValue);
      const [tokens, setTokens] = useState<PromptToken[]>([token]);
      return (
        <QueryClientProvider client={queryClient}>
          <ComposerPromptInput
            value={value}
            onChange={setValue}
            tokens={tokens}
            onTokensChange={setTokens}
            runtimeId={null}
          />
        </QueryClientProvider>
      );
    }

    await act(async () => root.render(<Harness />));
    const textarea = host.querySelector('textarea');
    if (!textarea) throw new Error('Composer textarea is missing');
    const range = findTokenRanges(initialValue, [token])[0];
    if (!range) throw new Error('Attachment token range is missing');

    expect(
      snapSelectionToTokens({ start: range.start + 1, end: range.start + 1 }, [range], range.start)
    ).toEqual({ start: range.end, end: range.end });

    await act(
      async () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        })
    );

    await act(async () => {
      textarea.setSelectionRange(range.end, range.end);
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Backspace',
          bubbles: true,
          cancelable: true,
        })
      );
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    });
    expect(textarea.value).toBe('before  after');
  });
});
