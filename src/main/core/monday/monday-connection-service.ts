import {
  CredentialConnectionService,
  requiredCredential,
} from '@main/core/issues/credential-connection-service';
import { createMondayClient, type MondayCredentials } from './monday-client';

export const mondayConnectionService = new CredentialConnectionService<MondayCredentials>({
  provider: 'monday',
  secretKey: 'yoda-monday-credentials',
  normalize: (credentials) => ({
    apiToken: requiredCredential(credentials.apiToken, 'Monday.com API token is required.'),
  }),
  verify: async (credentials) => {
    const client = createMondayClient(credentials);
    const data = await client.request<{
      me?: { name?: string; account?: { name?: string } | null } | null;
    }>('query { me { id name account { name } } }');
    return { displayName: data.me?.account?.name ?? data.me?.name };
  },
});
