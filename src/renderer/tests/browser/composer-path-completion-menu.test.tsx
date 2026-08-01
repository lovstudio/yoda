import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromptToken } from '@renderer/app/prompt-attachment-tokens';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getCatalog: vi.fn(async () => ({
    success: true,
    data: { skills: [] },
  })),
  listPathCompletions: vi.fn(async () => ({
    success: true,
    data: {
      entries: [{ path: 'agents', type: 'dir' }],
      total: 1,
      truncated: false,
      durationMs: 1,
    },
  })),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    app: {
      clipboardWriteText: vi.fn(),
      openIn: vi.fn(),
      triggerVoiceInput: vi.fn(),
    },
    fs: { listPathCompletions: mocks.listPathCompletions },
    skills: {
      getCatalog: mocks.getCatalog,
      route: vi.fn(),
    },
  },
}));

describe('ComposerPromptInput path completion menu', () => {
  let clippingHost: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    clippingHost = document.createElement('div');
    Object.assign(clippingHost.style, {
      height: '140px',
      left: '40px',
      overflow: 'hidden',
      position: 'fixed',
      top: '80px',
      width: '480px',
    });
    document.body.appendChild(clippingHost);
    root = createRoot(clippingHost);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    clippingHost.remove();
    document.querySelector('[data-path-completion-menu]')?.remove();
  });

  it('portals path candidates outside clipping composer ancestors', async () => {
    const { ComposerPromptInput } = await import('@renderer/app/composer-prompt-input');

    function Harness() {
      const [value, setValue] = useState('@~/');
      const [tokens, setTokens] = useState<PromptToken[]>([]);
      return (
        <QueryClientProvider client={queryClient}>
          <ComposerPromptInput
            value={value}
            onChange={setValue}
            tokens={tokens}
            onTokensChange={setTokens}
            runtimeId={null}
            projectId="project-1"
          />
        </QueryClientProvider>
      );
    }

    await act(async () => root.render(<Harness />));
    const textarea = clippingHost.querySelector('textarea');
    if (!textarea) throw new Error('Composer textarea is missing');

    await act(async () => {
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      textarea.focus();
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect(mocks.listPathCompletions).toHaveBeenCalledWith(
          'project-1',
          '.',
          expect.objectContaining({ pathKind: 'home' })
        );
        expect(document.querySelector('[data-path-completion-menu]')).not.toBeNull();
      });
    });

    const menu = document.querySelector<HTMLElement>('[data-path-completion-menu]');
    if (!menu) throw new Error('Path completion menu is missing');
    expect(clippingHost.contains(menu)).toBe(false);
    expect(getComputedStyle(menu).position).toBe('fixed');
    expect(menu.textContent).toContain('~/agents/');

    const menuRect = menu.getBoundingClientRect();
    expect(menuRect.left).toBeGreaterThanOrEqual(8);
    expect(menuRect.right).toBeLessThanOrEqual(window.innerWidth - 8);
    expect(menuRect.bottom).toBeLessThanOrEqual(window.innerHeight - 8);
  });
});
