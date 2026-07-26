import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromptPrinciplesSettings } from '@shared/app-settings';
import {
  derivePromptPrincipleName,
  PromptPrincipleSourceService,
} from './prompt-principle-source-service';

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  readFile: vi.fn(),
  settings: { items: [] } as PromptPrinciplesSettings,
  showOpenDialog: vi.fn(),
  stat: vi.fn(),
  updateComputed: vi.fn(),
}));

vi.mock('electron', () => ({
  dialog: { showOpenDialog: mocks.showOpenDialog },
}));

vi.mock('node:fs/promises', () => ({
  readFile: mocks.readFile,
  stat: mocks.stat,
}));

vi.mock('@main/lib/events', () => ({
  events: { emit: mocks.emit },
}));

vi.mock('./settings-service', () => ({
  appSettingsService: {
    get: vi.fn(async () => mocks.settings),
    updateComputed: mocks.updateComputed,
  },
}));

function fileStat(size = 128) {
  return {
    isFile: () => true,
    size,
  };
}

describe('prompt principle source service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settings = { items: [] };
    mocks.stat.mockResolvedValue(fileStat());
    mocks.readFile.mockResolvedValue('# Imported principle\n\nAlways verify the result.');
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/principle.md'] });
    mocks.updateComputed.mockImplementation(
      async (
        _key: string,
        compute: (current: PromptPrinciplesSettings) => PromptPrinciplesSettings
      ) => {
        mocks.settings = compute(mocks.settings);
        return mocks.settings;
      }
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses the first Markdown H1 and falls back to the source filename', () => {
    expect(
      derivePromptPrincipleName('intro\n## Not the title\n# Canonical title #\nbody', 'fallback')
    ).toBe('Canonical title');
    expect(derivePromptPrincipleName('No level-one heading', 'principle')).toBe('principle');
  });

  it('imports a selected file with its title, content, and refreshable path', async () => {
    const service = new PromptPrincipleSourceService();

    await expect(service.selectFile()).resolves.toMatchObject({
      status: 'success',
      name: 'Imported principle',
      text: '# Imported principle\n\nAlways verify the result.',
      source: {
        type: 'file',
        path: '/tmp/principle.md',
      },
    });
  });

  it('loads a URL and normalizes refresh and timeout limits', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('# Remote principle\n\nStay source-backed.'))
    );
    const service = new PromptPrincipleSourceService();

    await expect(
      service.loadUrl({
        url: 'https://example.com/rules.md',
        refreshIntervalMinutes: 0,
        timeoutSeconds: 999,
      })
    ).resolves.toMatchObject({
      status: 'success',
      name: 'Remote principle',
      source: {
        type: 'url',
        url: 'https://example.com/rules.md',
        refreshIntervalMinutes: 1,
        timeoutSeconds: 120,
      },
    });
  });

  it('aborts URL loading at the configured timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url: URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          })
      )
    );
    const service = new PromptPrincipleSourceService();

    const loading = service.loadUrl({
      url: 'https://example.com/slow.md',
      timeoutSeconds: 1,
    });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(loading).resolves.toEqual({
      status: 'error',
      error: { code: 'request_timeout' },
    });
  });

  it('refreshes source content atomically without replacing the editable title', async () => {
    mocks.settings = {
      items: [
        {
          id: 'principle-1',
          name: 'My custom title',
          text: 'Old content',
          enabled: true,
          source: { type: 'file', path: '/tmp/principle.md' },
        },
      ],
    };
    mocks.readFile.mockResolvedValue('# Upstream title\n\nNew content');
    const service = new PromptPrincipleSourceService();

    await expect(service.refresh('principle-1')).resolves.toMatchObject({ status: 'success' });
    expect(mocks.settings.items[0]).toMatchObject({
      name: 'My custom title',
      text: '# Upstream title\n\nNew content',
      source: {
        type: 'file',
        path: '/tmp/principle.md',
        lastError: undefined,
      },
    });
    expect(mocks.emit).toHaveBeenCalled();
  });

  it('keeps the last good content and records a failed URL refresh', async () => {
    mocks.settings = {
      items: [
        {
          id: 'principle-1',
          name: 'Remote',
          text: 'Last good content',
          enabled: true,
          source: {
            type: 'url',
            url: 'https://example.com/rules.md',
            refreshIntervalMinutes: 60,
            timeoutSeconds: 10,
          },
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Nope', { status: 503 }))
    );
    const service = new PromptPrincipleSourceService();

    await expect(service.refresh('principle-1')).resolves.toEqual({
      status: 'error',
      error: { code: 'http_error', detail: '503' },
    });
    expect(mocks.settings.items[0]).toMatchObject({
      text: 'Last good content',
      source: {
        lastError: { code: 'http_error', detail: '503' },
      },
    });
    service.dispose();
  });

  it('refreshes due URL sources while the settings UI is not mounted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T00:00:00.000Z'));
    mocks.settings = {
      items: [
        {
          id: 'principle-1',
          name: 'Scheduled',
          text: 'Old',
          enabled: true,
          source: {
            type: 'url',
            url: 'https://example.com/scheduled.md',
            refreshIntervalMinutes: 1,
            timeoutSeconds: 10,
            lastAttemptedAt: '2026-07-26T23:59:00.000Z',
          },
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('# Scheduled\n\nFresh'))
    );
    const service = new PromptPrincipleSourceService();

    await service.initialize();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(mocks.settings.items[0]?.text).toBe('# Scheduled\n\nFresh');
    service.dispose();
  });
});
