import {
  CredentialConnectionService,
  requiredCredential,
} from '@main/core/issues/credential-connection-service';
import { createTrelloClient, type TrelloCredentials } from './trello-client';

export const trelloConnectionService = new CredentialConnectionService<TrelloCredentials>({
  provider: 'trello',
  secretKey: 'yoda-trello-credentials',
  normalize: (credentials) => ({
    apiKey: requiredCredential(credentials.apiKey, 'Trello API key is required.'),
    apiToken: requiredCredential(credentials.apiToken, 'Trello API token is required.'),
  }),
  verify: async (credentials) => {
    const me = await createTrelloClient(credentials).members.getMember({
      id: 'me',
      fields: ['fullName', 'username'],
    });
    return { displayName: me.fullName ?? me.username };
  },
});
