import type {
  MobileApiError,
  MobileCreateDemandRequest,
  MobileCreateDemandResponse,
  MobileDashboardSnapshot,
  MobileSessionDetail,
  MobileSessionInputRequest,
  MobileSessionInputResponse,
  MobileTaskSessionsResponse,
} from '../../../src/shared/mobile-api';

export type MobileConnection = {
  baseUrl: string;
  token: string;
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
    throw new Error(
      `Cannot reach the Yoda gateway at ${baseUrl}. For a local address, check Local Network permission and Wi-Fi. For Relay, check that the desktop is online and Relay Pass is active.`
    );
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
