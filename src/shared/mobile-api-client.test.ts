import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  configureConnectionFailover,
  createDemand,
  fetchProfile,
  fetchSkills,
  fetchSnapshot,
  sendSessionInput,
  SESSION_INPUT_REQUEST_TIMEOUT_MS,
  uploadInputImage,
} from '../../apps/mobile/src/api-client';
import { MOBILE_RELAY_BASE_URL } from './mobile-relay';

const relayConnection = {
  baseUrl: `${MOBILE_RELAY_BASE_URL}/v1/devices/device-1`,
  token: 'mobile-token',
};

describe('mobile API connectivity diagnostics', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('identifies a phone network that cannot reach the Relay edge', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockRejectedValueOnce(new TypeError('Network request failed'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSnapshot(relayConnection)).rejects.toThrow(
      "Cannot reach Yoda Relay from this phone's current network"
    );

    expect(fetchMock).toHaveBeenCalledWith(`${MOBILE_RELAY_BASE_URL}/health`, {
      headers: { Accept: 'application/json' },
      signal: expect.any(AbortSignal),
    });
  });

  it('distinguishes a reachable Relay edge from an unreachable device route', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSnapshot(relayConnection)).rejects.toThrow(
      'Yoda Relay is reachable, but this desktop device route did not return an HTTP response'
    );
  });

  it('keeps local gateway guidance separate from Relay diagnostics', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Network failed'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchSnapshot({ baseUrl: 'http://192.168.1.20:3879', token: 'dev-token' })
    ).rejects.toThrow('Check Local Network permission, Wi-Fi');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('loads the mobile profile through the protected profile endpoint', async () => {
    const connection = { baseUrl: 'http://127.0.0.1:3879/', token: 'dev-token' };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ generatedAt: '2026-08-02T00:00:00.000Z' }), { status: 200 })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchProfile(connection)).resolves.toMatchObject({
      generatedAt: '2026-08-02T00:00:00.000Z',
    });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:3879/v1/profile', {
      headers: {
        Authorization: 'Bearer dev-token',
        'Content-Type': 'application/json',
      },
    });
  });

  it('loads the Skill catalog for the active conversation context', async () => {
    const connection = { baseUrl: 'http://127.0.0.1:3879/', token: 'dev-token' };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ runtimeId: 'codex', skills: [{ key: 'skill:one', id: 'frontend' }] }),
          { status: 200 }
        )
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchSkills(connection, {
        projectId: 'project 1',
        taskId: 'task/1',
        sessionId: 'session 1',
      })
    ).resolves.toMatchObject({ runtimeId: 'codex' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3879/v1/projects/project%201/tasks/task%2F1/sessions/session%201/skills',
      {
        headers: {
          Authorization: 'Bearer dev-token',
          'Content-Type': 'application/json',
        },
      }
    );
  });

  it('keeps the current task as the parent when creating a mobile subtask', async () => {
    const connection = { baseUrl: 'http://127.0.0.1:3879', token: 'dev-token' };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          task: { id: 'child-task', projectId: 'project-1' },
          sessionId: 'child-session',
        }),
        { status: 201 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    await createDemand(connection, {
      projectId: 'project-1',
      parentTaskId: 'parent-task',
      prompt: '实现移动端子任务入口',
    });

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:3879/v1/demands', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer dev-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectId: 'project-1',
        parentTaskId: 'parent-task',
        prompt: '实现移动端子任务入口',
      }),
    });
  });

  it('sends the stable request id used to deduplicate a retried follow-up', async () => {
    const connection = { baseUrl: 'http://127.0.0.1:3879', token: 'dev-token' };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          generatedAt: '2026-08-07T15:23:38.175Z',
          requestId: 'mobile-request-123456',
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      sendSessionInput(connection, 'project 1', 'task/1', 'session 1', {
        input: '继续完成',
        clientRequestId: 'mobile-request-123456',
      })
    ).resolves.toMatchObject({ ok: true, requestId: 'mobile-request-123456' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3879/v1/projects/project%201/tasks/task%2F1/sessions/session%201/input',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          input: '继续完成',
          clientRequestId: 'mobile-request-123456',
        }),
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('bounds a stalled follow-up request and explains that the draft is retained', async () => {
    vi.useFakeTimers();
    const connection = { baseUrl: 'http://127.0.0.1:3879', token: 'dev-token' };
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const request = sendSessionInput(connection, 'project', 'task', 'session', {
      input: '继续完成',
      clientRequestId: 'mobile-request-123456',
    });
    const assertion = expect(request).rejects.toThrow('内容已保留，可以重试');
    await vi.advanceTimersByTimeAsync(SESSION_INPUT_REQUEST_TIMEOUT_MS);

    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uploads image data in ordered chunks before completing it', async () => {
    const connection = { baseUrl: 'http://127.0.0.1:3879', token: 'dev-token' };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ attachmentId: 'attachment-1', chunkSizeBytes: 6 }), {
          status: 201,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ attachmentId: 'attachment-1', receivedBytes: 6 }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ attachmentId: 'attachment-1', receivedBytes: 7 }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            attachment: {
              id: 'attachment-1',
              kind: 'image',
              name: 'photo.jpg',
              mimeType: 'image/jpeg',
              sizeBytes: 7,
            },
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal('fetch', fetchMock);
    const onProgress = vi.fn();

    await expect(
      uploadInputImage(
        connection,
        {
          base64: Buffer.from('1234567').toString('base64'),
          mimeType: 'image/jpeg',
          name: 'photo.jpg',
        },
        onProgress
      )
    ).resolves.toMatchObject({ id: 'attachment-1', sizeBytes: 7 });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      offset: 0,
      dataBase64: Buffer.from('123456').toString('base64'),
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      offset: 6,
      dataBase64: Buffer.from('7').toString('base64'),
    });
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      'http://127.0.0.1:3879/v1/attachments/attachment-1/complete'
    );
    expect(onProgress.mock.calls).toEqual([
      [{ receivedBytes: 6, totalBytes: 7 }],
      [{ receivedBytes: 7, totalBytes: 7 }],
    ]);
  });
});

describe('mobile connection failover', () => {
  afterEach(() => {
    configureConnectionFailover(null);
    vi.unstubAllGlobals();
  });

  const dead = { baseUrl: 'http://192.168.100.124:3879', token: 'dev-mobile-token' };
  const alive = { baseUrl: 'http://192.168.100.60:3879', token: 'dev-mobile-token' };

  it('rediscovers the desktop when the only stored endpoint is the dead one', async () => {
    // The phone locked to the LAN holds exactly one address, so there is nothing
    // to fail over to. Without a sweep it retries that dead address forever.
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation((input) =>
        String(input).startsWith(alive.baseUrl)
          ? Promise.resolve(new Response(JSON.stringify({ tasks: [] }), { status: 200 }))
          : Promise.reject(new TypeError('Network request timed out'))
      );
    vi.stubGlobal('fetch', fetchMock);

    const rediscover = vi.fn().mockResolvedValue({ kind: 'lan' as const, ...alive });
    configureConnectionFailover({
      candidates: () => [{ kind: 'lan', ...dead }],
      onSwitch: vi.fn(),
      rediscover,
    });

    await expect(fetchSnapshot(dead)).resolves.toMatchObject({ tasks: [] });
    expect(rediscover).toHaveBeenCalledTimes(1);
  });

  it('does not send a write twice, but adopts the rediscovered address for the retry', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation((input) =>
        String(input).startsWith(alive.baseUrl)
          ? Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
          : Promise.reject(new TypeError('Network request timed out'))
      );
    vi.stubGlobal('fetch', fetchMock);

    const rediscover = vi.fn().mockResolvedValue({ kind: 'lan' as const, ...alive });
    configureConnectionFailover({
      candidates: () => [{ kind: 'lan', ...dead }],
      onSwitch: vi.fn(),
      rediscover,
    });

    await expect(createDemand(dead, { projectId: 'p1', prompt: 'hi' })).rejects.toThrow(
      `已切换到 ${alive.baseUrl}`
    );
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith(alive.baseUrl))).toBe(
      false
    );
  });

  it('reports the original failure when the sweep finds nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Network request timed out'))
    );
    const rediscover = vi.fn().mockResolvedValue(null);
    configureConnectionFailover({
      candidates: () => [{ kind: 'lan', ...dead }],
      onSwitch: vi.fn(),
      rediscover,
    });

    await expect(fetchSnapshot(dead)).rejects.toThrow('Cannot reach the local Yoda gateway');
    expect(rediscover).toHaveBeenCalledTimes(1);
  });

  it('never adopts an address that just failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Network request timed out'))
    );
    const rediscover = vi.fn().mockResolvedValue({ kind: 'lan' as const, ...dead });
    configureConnectionFailover({
      candidates: () => [{ kind: 'lan', ...dead }],
      onSwitch: vi.fn(),
      rediscover,
    });

    await expect(fetchSnapshot(dead)).rejects.toThrow('Cannot reach the local Yoda gateway');
  });
});
