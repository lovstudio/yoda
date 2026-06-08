import type {
  MobileApiError,
  MobileCreateDemandRequest,
  MobileCreateDemandResponse,
  MobileDashboardSnapshot,
  MobileSessionDetail,
  MobileTaskSessionsResponse,
} from '../../../src/shared/mobile-api';

export type MobileConnection = {
  baseUrl: string;
  token: string;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
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
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${connection.token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new Error(
      `Cannot reach desktop gateway at ${baseUrl}. Check that iPhone Local Network permission is enabled for Expo Go, both devices are on the same Wi-Fi, and the gateway URL opens in iPhone Safari.`
    );
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        'Desktop rejected the mobile gateway token. Rescan the desktop mobile QR, or restart the desktop app so the development token is active.'
      );
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
  sessionId: string
): Promise<MobileSessionDetail> {
  return request<MobileSessionDetail>(
    connection,
    `/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/sessions/${encodeURIComponent(sessionId)}`
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
