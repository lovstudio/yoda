export type AsanaCredentials = { accessToken: string };

export type AsanaWorkspace = { gid: string; name?: string };
export type AsanaNamedResource = { gid?: string; name?: string };

export type RawAsanaTask = {
  gid?: string;
  name?: string;
  notes?: string;
  permalink_url?: string;
  completed?: boolean;
  modified_at?: string;
  assignee?: AsanaNamedResource | null;
  projects?: AsanaNamedResource[];
  memberships?: Array<{
    section?: AsanaNamedResource | null;
    project?: AsanaNamedResource | null;
  }>;
};

export type AsanaUser = {
  name?: string;
  workspaces?: AsanaWorkspace[];
};

export type AsanaResponse<T> = { data?: T };

export const ASANA_USER_FIELDS = 'gid,name,workspaces.gid,workspaces.name';
export const ASANA_TASK_FIELDS =
  'name,notes,permalink_url,completed,modified_at,assignee.name,projects.name,memberships.section.name,memberships.project.name';

const ASANA_API_URL = 'https://app.asana.com/api/1.0';

function addQuery(url: URL, params: Record<string, string | number | boolean | undefined>) {
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
}

export class AsanaClient {
  constructor(private readonly accessToken: string) {}

  getUser(): Promise<AsanaResponse<AsanaUser>> {
    return this.get('/users/me', { opt_fields: ASANA_USER_FIELDS });
  }

  getTasks(params: { workspace: string; limit: number }): Promise<AsanaResponse<RawAsanaTask[]>> {
    return this.get('/tasks', {
      assignee: 'me',
      workspace: params.workspace,
      completed_since: 'now',
      limit: params.limit,
      opt_fields: ASANA_TASK_FIELDS,
    });
  }

  searchTasks(
    workspace: string,
    params: { text: string; limit: number }
  ): Promise<AsanaResponse<RawAsanaTask[]>> {
    return this.get(`/workspaces/${encodeURIComponent(workspace)}/tasks/search`, {
      text: params.text,
      resource_subtype: 'default_task',
      completed: false,
      limit: params.limit,
      opt_fields: ASANA_TASK_FIELDS,
    });
  }

  private async get<T>(
    pathname: string,
    params: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    const url = new URL(`${ASANA_API_URL}${pathname}`);
    addQuery(url, params);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        detail || `Asana request failed (${response.status} ${response.statusText}).`
      );
    }
    return (await response.json()) as T;
  }
}

export function createAsanaClient(credentials: AsanaCredentials): AsanaClient {
  return new AsanaClient(credentials.accessToken);
}
