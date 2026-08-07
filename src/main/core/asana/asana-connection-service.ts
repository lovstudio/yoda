import {
  CredentialConnectionService,
  requiredCredential,
} from '@main/core/issues/credential-connection-service';
import {
  createAsanaClient,
  type AsanaCredentials,
  type AsanaResponse,
  type AsanaUser,
} from './asana-client';

export const asanaConnectionService = new CredentialConnectionService<AsanaCredentials>({
  provider: 'asana',
  secretKey: 'yoda-asana-credentials',
  normalize: (credentials) => ({
    accessToken: requiredCredential(
      credentials.accessToken,
      'Asana personal access token is required.'
    ),
  }),
  verify: async (credentials) => {
    const client = createAsanaClient(credentials);
    const response = (await client.getUser()) as AsanaResponse<AsanaUser>;
    const user = response.data;
    if (!user) throw new Error('Unexpected Asana user response.');
    return { displayName: user.workspaces?.[0]?.name ?? user.name };
  },
});
