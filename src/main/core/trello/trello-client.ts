import { createTrelloClient as createClient } from 'trello.js';

export type TrelloCredentials = { apiKey: string; apiToken: string };
export type TrelloClient = ReturnType<typeof createClient>;

export function createTrelloClient(credentials: TrelloCredentials): TrelloClient {
  return createClient({
    apiKey: credentials.apiKey,
    apiToken: credentials.apiToken,
    skipParsing: true,
  });
}
