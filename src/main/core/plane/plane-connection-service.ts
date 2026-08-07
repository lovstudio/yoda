import {
  CredentialConnectionService,
  requiredCredential,
} from '@main/core/issues/credential-connection-service';
import { createPlaneClient, PLANE_CLOUD_API_BASE_URL, type PlaneCredentials } from './plane-client';

function normalizeApiBaseUrl(value: string | undefined): string {
  const raw = requiredCredential(value, 'A Plane API base URL is required.');
  const parsed = new URL(raw);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Plane API base URL must use HTTP or HTTPS.');
  }
  return parsed.toString().replace(/\/$/, '');
}

export const planeConnectionService = new CredentialConnectionService<PlaneCredentials>({
  provider: 'plane',
  secretKey: 'yoda-plane-credentials',
  normalize: (credentials) => ({
    apiBaseUrl: normalizeApiBaseUrl(credentials.apiBaseUrl || PLANE_CLOUD_API_BASE_URL),
    workspaceSlug: requiredCredential(
      credentials.workspaceSlug,
      'Plane workspace slug is required.'
    ),
    apiKey: requiredCredential(credentials.apiKey, 'Plane API key is required.'),
  }),
  verify: async (credentials) => {
    const client = createPlaneClient(credentials);
    const user = await client.users.me();
    await client.projects.list(credentials.workspaceSlug, { limit: 1 });
    const fullName = [user.first_name?.trim(), user.last_name?.trim()].filter(Boolean).join(' ');
    return {
      displayName: user.display_name?.trim() || fullName || user.email?.trim() || undefined,
    };
  },
});
