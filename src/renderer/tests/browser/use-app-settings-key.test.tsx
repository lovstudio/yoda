import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_SETTINGS_META_REQUEST_TIMEOUT_MS,
  useAppSettingsKey,
} from '@renderer/features/settings/use-app-settings-key';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  getWithMeta: vi.fn(),
  reset: vi.fn(),
  resetField: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    appSettings: {
      get: mocks.get,
      getWithMeta: mocks.getWithMeta,
      reset: mocks.reset,
      resetField: mocks.resetField,
      update: mocks.update,
    },
  },
}));

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function interfaceMeta(dockSessionHistoryRows: number) {
  const value = { dockSessionHistoryRows };
  return { value, defaults: value, overrides: {} };
}

describe('useAppSettingsKey', () => {
  let host: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let latest: { isLoading: boolean; rows: number | undefined };
  let unhandledRejections: unknown[];
  let onUnhandledRejection: (event: PromiseRejectionEvent) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    latest = { isLoading: true, rows: undefined };
    unhandledRejections = [];
    onUnhandledRejection = (event) => {
      unhandledRejections.push(event.reason);
    };
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    queryClient = new QueryClient({
      // A retrying client default proves the hook's own no-retry policy wins.
      defaultOptions: { queries: { retry: 3 }, mutations: { retry: false } },
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
    host.remove();
    vi.useRealTimers();
  });

  it('releases loading immediately after an RPC rejection without retrying or leaking it', async () => {
    mocks.getWithMeta.mockRejectedValueOnce(new Error('settings IPC unavailable'));

    await renderHarness();
    await flushRealTimers();

    expect(latest).toEqual({ isLoading: false, rows: undefined });
    expect(mocks.getWithMeta).toHaveBeenCalledTimes(1);
    expect(unhandledRejections).toEqual([]);
  });

  it('times out a stuck RPC before the staging deadline and ignores its late value', async () => {
    const staleRequest = deferred<ReturnType<typeof interfaceMeta>>();
    mocks.getWithMeta.mockReturnValueOnce(staleRequest.promise);

    await renderHarness();
    expect(latest.isLoading).toBe(true);
    expect(APP_SETTINGS_META_REQUEST_TIMEOUT_MS).toBeLessThan(900);

    const startedAt = performance.now();
    await waitFor(() => !latest.isLoading, 850);
    const elapsed = performance.now() - startedAt;
    expect(latest).toEqual({ isLoading: false, rows: undefined });
    expect(elapsed).toBeLessThan(900);
    expect(mocks.getWithMeta).toHaveBeenCalledTimes(1);
    expect(unhandledRejections).toEqual([]);

    mocks.getWithMeta.mockResolvedValueOnce(interfaceMeta(8));
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['appSettings', 'interface', 'meta'] });
    });
    await flushRealTimers();
    expect(latest).toEqual({ isLoading: false, rows: 8 });

    staleRequest.resolve(interfaceMeta(2));
    await flushRealTimers();
    expect(latest).toEqual({ isLoading: false, rows: 8 });
    expect(unhandledRejections).toEqual([]);
  });

  async function renderHarness(): Promise<void> {
    function Harness() {
      const settings = useAppSettingsKey('interface');
      const rows = settings.value?.dockSessionHistoryRows;
      useEffect(() => {
        latest = { isLoading: settings.isLoading, rows };
      }, [rows, settings.isLoading]);
      return null;
    }

    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, createElement(Harness))
      );
    });
  }
});

async function flushRealTimers(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!predicate() && performance.now() < deadline) {
    await flushRealTimers();
  }
  expect(predicate()).toBe(true);
}
