import {
  CredentialConnectionService,
  requiredCredential,
} from '@main/core/issues/credential-connection-service';
import { createNotionClient, toNotionErrorMessage, type NotionCredentials } from './notion-client';

export const notionConnectionService = new CredentialConnectionService<NotionCredentials>({
  provider: 'notion',
  secretKey: 'yoda-notion-credentials',
  normalize: (credentials) => ({
    apiToken: requiredCredential(credentials.apiToken, 'Notion integration token is required.'),
  }),
  verify: async (credentials) => {
    const user = await createNotionClient(credentials).users.me({});
    return { displayName: user.name ?? (user.type === 'bot' ? 'Notion bot' : 'Notion user') };
  },
  toErrorMessage: toNotionErrorMessage,
});
