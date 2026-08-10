import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prompt } from '@shared/prompt-library';
import { derivePromptName, PromptSourceService } from './prompt-source-service';

const mocks = vi.hoisted(() => ({
  prompts: [] as Prompt[],
  makeTempDirectory: vi.fn(),
  readFile: vi.fn(),
  remove: vi.fn(),
  showOpenDialog: vi.fn(),
  stat: vi.fn(),
  update: vi.fn(),
}));

vi.mock('electron', () => ({
  dialog: { showOpenDialog: mocks.showOpenDialog },
}));

vi.mock('node:fs/promises', () => ({
  mkdtemp: mocks.makeTempDirectory,
  readFile: mocks.readFile,
  rm: mocks.remove,
  stat: mocks.stat,
}));

vi.mock('./prompt-library-service', () => ({
  promptLibraryService: {
    list: vi.fn(async () => mocks.prompts),
    update: mocks.update,
  },
}));

function prompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: 'prompt-1',
    title: 'Custom title',
    description: '',
    content: 'Old content',
    tags: [],
    extraInfo: '',
    injectionEnabled: true,
    injectionOrder: 0,
    bindings: { global: true, projectIds: [] },
    version: '1.0.0',
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
    ...overrides,
  };
}

function fileStat(size = 128) {
  return { isFile: () => true, size };
}

describe('prompt source service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prompts = [];
    mocks.makeTempDirectory.mockResolvedValue('/tmp/yoda-prompt-git-test');
    mocks.stat.mockResolvedValue(fileStat());
    mocks.readFile.mockResolvedValue('# Imported prompt\n\nAlways verify the result.');
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/prompt.md'] });
    mocks.update.mockImplementation(async (id: string, patch: Partial<Prompt>) => {
      mocks.prompts = mocks.prompts.map((item) => (item.id === id ? { ...item, ...patch } : item));
      return mocks.prompts.find((item) => item.id === id) ?? null;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses the first Markdown H1 and falls back to the source filename', () => {
    expect(derivePromptName('intro\n## Not the title\n# Canonical title #\nbody', 'fallback')).toBe(
      'Canonical title'
    );
    expect(derivePromptName('No level-one heading', 'prompt')).toBe('prompt');
  });

  it('loads a selected file as a prompt source', async () => {
    const service = new PromptSourceService();
    await expect(service.selectFile()).resolves.toMatchObject({
      status: 'success',
      name: 'Imported prompt',
      text: '# Imported prompt\n\nAlways verify the result.',
      source: { type: 'file', path: '/tmp/prompt.md' },
    });
  });

  it('loads a URL and clamps refresh and timeout limits', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('# Remote prompt\n\nSource-backed.'))
    );
    const service = new PromptSourceService();
    await expect(
      service.loadUrl({
        url: 'https://example.com/prompt.md',
        refreshIntervalMinutes: 0,
        timeoutSeconds: 999,
      })
    ).resolves.toMatchObject({
      status: 'success',
      name: 'Remote prompt',
      source: {
        type: 'url',
        url: 'https://example.com/prompt.md',
        refreshIntervalMinutes: 1,
        timeoutSeconds: 120,
      },
    });
  });

  it('turns a Gist page URL into its raw content endpoint', async () => {
    const fetch = vi.fn(async () => new Response('# Gist prompt'));
    vi.stubGlobal('fetch', fetch);
    const service = new PromptSourceService();

    await service.loadUrl({ url: 'https://gist.github.com/owner/abc123' });

    expect(fetch).toHaveBeenCalledWith(
      new URL('https://gist.githubusercontent.com/owner/abc123/raw'),
      expect.any(Object)
    );
  });

  it('rejects Git paths that leave the repository', async () => {
    const service = new PromptSourceService();
    await expect(
      service.loadGit({
        repositoryUrl: 'https://github.com/lovstudio/prompts.git',
        filePath: '../outside.md',
      })
    ).resolves.toEqual({
      status: 'error',
      error: { code: 'invalid_git_path' },
    });
  });

  it('refreshes sourced content without replacing prompt metadata', async () => {
    mocks.prompts = [prompt({ source: { type: 'file', path: '/tmp/prompt.md' } })];
    mocks.readFile.mockResolvedValue('# Upstream title\n\nNew content');
    const service = new PromptSourceService();

    await expect(service.refresh('prompt-1')).resolves.toMatchObject({ status: 'success' });
    expect(mocks.prompts[0]).toMatchObject({
      title: 'Custom title',
      content: '# Upstream title\n\nNew content',
      source: { type: 'file', path: '/tmp/prompt.md', lastError: undefined },
    });
  });

  it('keeps the last good content and records refresh errors', async () => {
    mocks.prompts = [
      prompt({
        source: {
          type: 'url',
          url: 'https://example.com/prompt.md',
          refreshIntervalMinutes: 60,
          timeoutSeconds: 10,
        },
      }),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Nope', { status: 503 }))
    );
    const service = new PromptSourceService();

    await expect(service.refresh('prompt-1')).resolves.toEqual({
      status: 'error',
      error: { code: 'http_error', detail: '503' },
    });
    expect(mocks.prompts[0]).toMatchObject({
      content: 'Old content',
      source: { lastError: { code: 'http_error', detail: '503' } },
    });
    service.dispose();
  });
});
