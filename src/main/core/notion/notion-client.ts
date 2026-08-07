import { APIErrorCode, Client, ClientErrorCode, isNotionClientError } from '@notionhq/client';

export type NotionCredentials = { apiToken: string };

export function createNotionClient(credentials: NotionCredentials): Client {
  return new Client({ auth: credentials.apiToken });
}

export function toNotionErrorMessage(error: unknown, fallback: string): string {
  if (!isNotionClientError(error)) {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  switch (error.code) {
    case APIErrorCode.Unauthorized:
      return 'Notion authentication failed. Check your integration token.';
    case APIErrorCode.RestrictedResource:
      return 'Notion token is missing the required capabilities or page access.';
    case APIErrorCode.ObjectNotFound:
      return 'Notion resource was not found or the integration does not have access.';
    case APIErrorCode.RateLimited:
      return 'Notion API rate limit exceeded. Please try again shortly.';
    case APIErrorCode.InternalServerError:
    case APIErrorCode.ServiceUnavailable:
    case APIErrorCode.GatewayTimeout:
    case ClientErrorCode.RequestTimeout:
      return 'Notion API is temporarily unavailable. Please try again.';
    default:
      return error.message || fallback;
  }
}
