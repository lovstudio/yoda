import { ApiClient } from '@mondaydotcomorg/api';

export type MondayCredentials = { apiToken: string };
export type MondayClient = ApiClient;

export type MondayColumnValue = {
  id: string;
  type: string;
  text?: string | null;
};

export type MondayItem = {
  id: string;
  name: string;
  updated_at?: string | null;
  column_values: MondayColumnValue[];
};

export type MondayBoard = {
  id: string;
  name: string;
  url: string;
  items_page: { items: MondayItem[] };
};

export function createMondayClient(credentials: MondayCredentials): MondayClient {
  return new ApiClient({ token: credentials.apiToken });
}

export async function queryMondayBoards(
  client: MondayClient,
  limit: number,
  searchTerm?: string
): Promise<MondayBoard[]> {
  const query = `query ($limit: Int!, $queryParams: ItemsQuery) {
    boards(limit: 20) {
      id name url
      items_page(limit: $limit, query_params: $queryParams) {
        items { id name updated_at column_values { id type text } }
      }
    }
  }`;
  const queryParams = searchTerm
    ? {
        rules: [
          {
            column_id: 'name',
            compare_value: [searchTerm],
            operator: 'contains_text',
          },
        ],
        order_by: [{ column_id: '__last_updated__', direction: 'desc' }],
      }
    : { order_by: [{ column_id: '__last_updated__', direction: 'desc' }] };
  const data = await client.request<{ boards: MondayBoard[] }>(query, { limit, queryParams });
  return data.boards;
}
