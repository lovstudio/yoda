import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogSkill } from '@shared/skills/types';
import type { PromptToken } from '@renderer/app/prompt-attachment-tokens';
import '../../index.css';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeSkill(index: number): CatalogSkill {
  const id =
    index === 0
      ? 'knowledge-update'
      : index === 1
        ? 'artifact-template-operating-review'
        : index === 29
          ? `skill-${'very-long-command-'.repeat(10)}29`
          : `skill-${String(index).padStart(2, '0')}`;
  const description =
    index === 1
      ? 'Create a presentation using the Operating Review template and its retained reference file. Use when the user selects Operating Review. Run weekly reviews with scorecards, functional updates, risks, decisions, and action items.'
      : `Description for ${id}`;
  return {
    key: `user:${id}`,
    ref: {
      key: `user:${id}`,
      id,
      source: 'local',
      locator: `/tmp/${id}`,
    },
    id,
    displayName: `Skill ${String(index).padStart(2, '0')}`,
    description,
    source: 'local',
    scope: 'user',
    managed: false,
    frontmatter: { name: id, description },
    installed: true,
    localPath: `/tmp/${id}`,
  };
}

const mocks = vi.hoisted(() => ({
  getCatalog: vi.fn(async () => ({
    success: true,
    data: {
      version: 1,
      lastUpdated: '2026-08-13T00:00:00.000Z',
      skills: Array.from({ length: 30 }, (_, index) => makeSkill(index)),
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
      getHomeDir: vi.fn(async () => '/Users/tester'),
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

describe('ComposerPromptInput skill shortcut menu', () => {
  let host: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    host = document.createElement('div');
    Object.assign(host.style, {
      bottom: '24px',
      left: '40px',
      position: 'fixed',
      width: '480px',
    });
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    host.remove();
    document.querySelector('[data-skill-shortcut-menu]')?.remove();
  });

  it('constrains candidates and keeps manual scrolling stable', async () => {
    const { ComposerPromptInput } = await import('@renderer/app/composer-prompt-input');

    function Harness() {
      const [value, setValue] = useState('/');
      const [tokens, setTokens] = useState<PromptToken[]>([]);
      return (
        <QueryClientProvider client={queryClient}>
          <ComposerPromptInput
            value={value}
            onChange={setValue}
            tokens={tokens}
            onTokensChange={setTokens}
            runtimeId="codex"
            projectId="project-1"
          />
        </QueryClientProvider>
      );
    }

    await act(async () => root.render(<Harness />));
    const textarea = host.querySelector('textarea');
    if (!textarea) throw new Error('Composer textarea is missing');

    await act(async () => {
      textarea.setSelectionRange(1, 1);
      textarea.focus();
    });

    const menu = await vi.waitFor(() => {
      const candidate = document.querySelector<HTMLElement>('[data-skill-shortcut-menu]');
      expect(candidate).not.toBeNull();
      expect(candidate?.scrollHeight).toBeGreaterThan(candidate?.clientHeight ?? 0);
      return candidate as HTMLElement;
    });
    expect(menu.scrollWidth).toBeLessThanOrEqual(menu.clientWidth);

    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    menu.scrollTop = 180;
    expect(menu.scrollTop).toBeGreaterThan(100);

    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    expect(menu.scrollTop).toBeGreaterThan(100);
  });

  it('keeps inline command completion scoped to invocable names', async () => {
    const { ComposerPromptInput } = await import('@renderer/app/composer-prompt-input');

    function Harness() {
      const [value, setValue] = useState('$update');
      const [tokens, setTokens] = useState<PromptToken[]>([]);
      return (
        <QueryClientProvider client={queryClient}>
          <ComposerPromptInput
            value={value}
            onChange={setValue}
            tokens={tokens}
            onTokensChange={setTokens}
            runtimeId="codex"
            projectId="project-1"
          />
        </QueryClientProvider>
      );
    }

    await act(async () => root.render(<Harness />));
    const textarea = host.querySelector('textarea');
    if (!textarea) throw new Error('Composer textarea is missing');

    await act(async () => {
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      textarea.focus();
    });

    const menu = await vi.waitFor(() => {
      const candidate = document.querySelector<HTMLElement>('[data-skill-shortcut-menu]');
      expect(candidate).not.toBeNull();
      return candidate as HTMLElement;
    });
    expect(menu.textContent).toContain('knowledge-update');
    expect(menu.textContent).not.toContain('artifact-template-operating-review');
  });

  it('shows description match context for explicit skill search', async () => {
    const { ComposerPromptInput } = await import('@renderer/app/composer-prompt-input');

    function Harness() {
      const [value, setValue] = useState('$');
      const [tokens, setTokens] = useState<PromptToken[]>([]);
      return (
        <QueryClientProvider client={queryClient}>
          <ComposerPromptInput
            value={value}
            onChange={setValue}
            tokens={tokens}
            onTokensChange={setTokens}
            runtimeId="codex"
            projectId="project-1"
          />
        </QueryClientProvider>
      );
    }

    await act(async () => root.render(<Harness />));
    const textarea = host.querySelector('textarea');
    if (!textarea) throw new Error('Composer textarea is missing');

    await act(async () => {
      textarea.setSelectionRange(1, 1);
      textarea.focus();
    });

    const searchInput = await vi.waitFor(() => {
      const candidate = document.querySelector<HTMLInputElement>(
        '[data-skill-shortcut-menu] input[type="search"]'
      );
      expect(candidate).not.toBeNull();
      return candidate as HTMLInputElement;
    });

    await act(async () => {
      searchInput.value = 'update';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const artifactOption = await vi.waitFor(() => {
      const candidate = Array.from(
        document.querySelectorAll<HTMLElement>('[data-skill-shortcut-menu] [role="option"]')
      ).find((option) => option.textContent?.includes('artifact-template-operating-review'));
      expect(candidate).not.toBeUndefined();
      return candidate as HTMLElement;
    });
    expect(artifactOption.textContent).toContain('functional updates');
  });
});
