import { PlaneClient as PlaneSdkClient } from '@makeplane/plane-node-sdk';

export const PLANE_CLOUD_API_BASE_URL = 'https://api.plane.so';

export type PlaneCredentials = {
  apiBaseUrl: string;
  workspaceSlug: string;
  apiKey: string;
};

export function createPlaneClient(credentials: PlaneCredentials): PlaneSdkClient {
  return new PlaneSdkClient({ baseUrl: credentials.apiBaseUrl, apiKey: credentials.apiKey });
}

export function planeIssueUrl(credentials: PlaneCredentials, identifier: string): string {
  const apiBase = new URL(credentials.apiBaseUrl);
  const browserBase =
    credentials.apiBaseUrl === PLANE_CLOUD_API_BASE_URL
      ? 'https://app.plane.so'
      : `${apiBase.protocol}//${apiBase.host}${apiBase.pathname.replace(/\/+$/, '')}`;
  return `${browserBase}/${encodeURIComponent(credentials.workspaceSlug)}/browse/${encodeURIComponent(identifier)}`;
}
