import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDemand,
  fetchProfile,
  fetchSnapshot,
  uploadInputImage,
} from '../../apps/mobile/src/api-client';
import { MOBILE_RELAY_BASE_URL } from './mobile-relay';

const relayConnection = {
  baseUrl: `${MOBILE_RELAY_BASE_URL}/v1/devices/device-1`,
  token: 'mobile-token',
};

describe('mobile API connectivity diagnostics', () => {
  afterEach(() => {
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
