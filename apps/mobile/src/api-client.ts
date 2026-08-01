import {
  MOBILE_INPUT_ATTACHMENT_MAX_BYTES,
  type MobileApiError,
  type MobileCreateDemandRequest,
  type MobileCreateDemandResponse,
  type MobileDashboardSnapshot,
  type MobileInputAttachment,
  type MobileInputAttachmentChunkResponse,
  type MobileInputAttachmentCompleteResponse,
  type MobileInputAttachmentCreateResponse,
  type MobileInputAttachmentDiscardResponse,
  type MobileSessionDetail,
  type MobileSessionInputRequest,
  type MobileSessionInputResponse,
  type MobileTaskSessionsResponse,
} from '../../../src/shared/mobile-api';
import { MOBILE_RELAY_BASE_URL } from '../../../src/shared/mobile-relay';

const RELAY_HEALTH_TIMEOUT_MS = 8_000;

export type MobileConnection = {
  baseUrl: string;
  token: string;
};

export type MobileInputImageUploadProgress = {
  receivedBytes: number;
  totalBytes: number;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function mobileApiUrl(connection: MobileConnection, path: string): string {
  return `${normalizeBaseUrl(connection.baseUrl)}${path}`;
}

export function mobileApiHeaders(
  connection: MobileConnection,
  headers?: HeadersInit
): Record<string, string> {
  const result: Record<string, string> = {
    Authorization: `Bearer ${connection.token}`,
    'Content-Type': 'application/json',
  };
  if (headers) new Headers(headers).forEach((value, key) => (result[key] = value));
  return result;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as Partial<MobileApiError>;
    return body.error?.message || `Request failed with ${response.status}`;
  } catch {
    return `Request failed with ${response.status}`;
  }
}

type RelayHealthProbe =
  | { reachedEdge: true; healthy: boolean; status: number }
  | { reachedEdge: false; error: string };

function isOfficialRelayConnection(baseUrl: string): boolean {
  try {
    const connectionUrl = new URL(baseUrl);
    const relayUrl = new URL(MOBILE_RELAY_BASE_URL);
    return (
      connectionUrl.origin === relayUrl.origin &&
      /^\/v1\/devices\/[^/]+\/?$/.test(connectionUrl.pathname)
    );
  } catch {
    return false;
  }
}

async function probeRelayHealth(): Promise<RelayHealthProbe> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RELAY_HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(`${MOBILE_RELAY_BASE_URL}/health`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    return { reachedEdge: true, healthy: response.ok, status: response.status };
  } catch (error) {
    return {
      reachedEdge: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function gatewayNetworkError(baseUrl: string, error: unknown): Promise<Error> {
  const detail = error instanceof Error ? error.message : String(error);
  if (!isOfficialRelayConnection(baseUrl)) {
    return new Error(
      `Cannot reach the local Yoda gateway at ${baseUrl}. Check Local Network permission, Wi-Fi, and that the desktop gateway is running. Diagnostic: ${detail}`
    );
  }

  const health = await probeRelayHealth();
  if (!health.reachedEdge) {
    return new Error(
      `Cannot reach Yoda Relay from this phone's current network. No HTTP response was received from ${MOBILE_RELAY_BASE_URL}. On iPhone, enable Settings > Cellular > Yoda Mobile, then retry. If it is already enabled, switch between cellular and Wi-Fi. Diagnostic: gateway=${detail}; health=${health.error}`
    );
  }
  if (!health.healthy) {
    return new Error(
      `Yoda Relay is reachable, but its health check returned HTTP ${health.status}. Wait a moment and retry. Diagnostic: gateway=${detail}`
    );
  }
  return new Error(
    `Yoda Relay is reachable, but this desktop device route did not return an HTTP response: ${baseUrl}. Keep Yoda open on the desktop, confirm Relay shows connected, then retry or generate a new pairing code. Diagnostic: ${detail}`
  );
}

async function request<T>(
  connection: MobileConnection,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const baseUrl = normalizeBaseUrl(connection.baseUrl);
  let response: Response;
  try {
    response = await fetch(mobileApiUrl(connection, path), {
      ...init,
      headers: mobileApiHeaders(connection, init.headers),
    });
  } catch (error) {
    console.warn('[Yoda Mobile] Gateway request failed', {
      error: error instanceof Error ? error.message : String(error),
      url: mobileApiUrl(connection, path),
    });
    throw await gatewayNetworkError(baseUrl, error);
  }

  if (!response.ok) {
    if (response.status === 401) {
      if (baseUrl.startsWith('https://')) {
        throw new Error('Yoda Relay credential is no longer valid. Pair this phone again.');
      }
      throw new Error(
        'Desktop rejected the mobile gateway token. Rescan the desktop mobile QR, or restart the desktop app so the development token is active.'
      );
    }
    if (response.status === 402) {
      throw new Error('Yoda Relay Pass is not active. Renew it from the desktop account settings.');
    }
    throw new Error(await readError(response));
  }

  return (await response.json()) as T;
}

export function fetchSnapshot(connection: MobileConnection): Promise<MobileDashboardSnapshot> {
  return request<MobileDashboardSnapshot>(connection, '/v1/snapshot');
}

export function fetchTaskSessions(
  connection: MobileConnection,
  projectId: string,
  taskId: string
): Promise<MobileTaskSessionsResponse> {
  return request<MobileTaskSessionsResponse>(
    connection,
    `/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/sessions`
  );
}

export function fetchSessionDetail(
  connection: MobileConnection,
  projectId: string,
  taskId: string,
  sessionId: string,
  signal?: AbortSignal
): Promise<MobileSessionDetail> {
  return request<MobileSessionDetail>(
    connection,
    `/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/sessions/${encodeURIComponent(sessionId)}`,
    { signal }
  );
}

export function sendSessionInput(
  connection: MobileConnection,
  projectId: string,
  taskId: string,
  sessionId: string,
  body: MobileSessionInputRequest
): Promise<MobileSessionInputResponse> {
  return request<MobileSessionInputResponse>(
    connection,
    `/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/sessions/${encodeURIComponent(sessionId)}/input`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    }
  );
}

export function createDemand(
  connection: MobileConnection,
  body: MobileCreateDemandRequest
): Promise<MobileCreateDemandResponse> {
  return request<MobileCreateDemandResponse>(connection, '/v1/demands', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function base64ByteLength(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

export async function uploadInputImage(
  connection: MobileConnection,
  input: { base64: string; mimeType: string; name: string },
  onProgress?: (progress: MobileInputImageUploadProgress) => void
): Promise<MobileInputAttachment> {
  const sizeBytes = base64ByteLength(input.base64);
  if (sizeBytes <= 0 || sizeBytes > MOBILE_INPUT_ATTACHMENT_MAX_BYTES) {
    throw new Error(
      `Each image must be smaller than ${Math.floor(MOBILE_INPUT_ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB.`
    );
  }

  const created = await request<MobileInputAttachmentCreateResponse>(
    connection,
    '/v1/attachments',
    {
      method: 'POST',
      body: JSON.stringify({
        kind: 'image',
        mimeType: input.mimeType,
        name: input.name,
        sizeBytes,
      }),
    }
  );

  try {
    const rawBytesPerChunk = created.chunkSizeBytes - (created.chunkSizeBytes % 3);
    if (!Number.isSafeInteger(rawBytesPerChunk) || rawBytesPerChunk < 3) {
      throw new Error('Desktop returned an invalid image upload chunk size.');
    }
    const base64CharsPerChunk = (rawBytesPerChunk / 3) * 4;
    let offset = 0;
    for (let cursor = 0; cursor < input.base64.length; cursor += base64CharsPerChunk) {
      const dataBase64 = input.base64.slice(cursor, cursor + base64CharsPerChunk);
      const chunk = await request<MobileInputAttachmentChunkResponse>(
        connection,
        `/v1/attachments/${encodeURIComponent(created.attachmentId)}/chunks`,
        {
          method: 'POST',
          body: JSON.stringify({ offset, dataBase64 }),
        }
      );
      offset = chunk.receivedBytes;
      onProgress?.({ receivedBytes: offset, totalBytes: sizeBytes });
    }
    const completed = await request<MobileInputAttachmentCompleteResponse>(
      connection,
      `/v1/attachments/${encodeURIComponent(created.attachmentId)}/complete`,
      { method: 'POST', body: '{}' }
    );
    return completed.attachment;
  } catch (error) {
    await request<MobileInputAttachmentDiscardResponse>(
      connection,
      `/v1/attachments/${encodeURIComponent(created.attachmentId)}/discard`,
      { method: 'POST', body: '{}' }
    ).catch(() => undefined);
    throw error;
  }
}

export function discardInputAttachment(
  connection: MobileConnection,
  attachmentId: string
): Promise<MobileInputAttachmentDiscardResponse> {
  return request<MobileInputAttachmentDiscardResponse>(
    connection,
    `/v1/attachments/${encodeURIComponent(attachmentId)}/discard`,
    { method: 'POST', body: '{}' }
  );
}
