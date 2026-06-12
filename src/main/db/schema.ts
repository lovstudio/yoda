import { relations, sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import type { AgentAccountProviderId } from '@shared/runtime-registry';
import type { TaskNamingContextSnapshot, TaskNamingStatus } from '@shared/task-naming';
import type { StoredBranch } from '@main/core/tasks/stored-branch';

export const sshConnections = sqliteTable(
  'ssh_connections',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    host: text('host').notNull(),
    port: integer('port').notNull().default(22),
    username: text('username').notNull(),
    authType: text('auth_type').notNull().default('agent'), // 'password' | 'key' | 'agent'
    privateKeyPath: text('private_key_path'), // optional, for key auth
    useAgent: integer('use_agent').notNull().default(0), // boolean, 0=false, 1=true
    metadata: text('metadata'), // JSON for additional connection-specific data
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    nameIdx: uniqueIndex('idx_ssh_connections_name').on(table.name),
    hostIdx: index('idx_ssh_connections_host').on(table.host),
  })
);

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    alias: text('alias'),
    path: text('path').notNull(),
    workspaceProvider: text('workspace_provider').notNull().default('local'), // 'local' | 'ssh'
    workspaceId: text('workspace_id').references(() => workspaces.id, {
      onDelete: 'set null',
    }),
    baseRef: text('base_ref'),
    sshConnectionId: text('ssh_connection_id').references(() => sshConnections.id, {
      onDelete: 'set null',
    }),
    archivedAt: text('archived_at'), // null = active, timestamp = archived
    isInternal: integer('is_internal').notNull().default(0), // 1 = internal Yoda-managed project (no git, hidden from project list)
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    pathIdx: uniqueIndex('idx_projects_path').on(table.path),
    sshConnectionIdIdx: index('idx_projects_ssh_connection_id').on(table.sshConnectionId),
    workspaceIdIdx: index('idx_projects_workspace_id').on(table.workspaceId),
    archivedAtIdx: index('idx_projects_archived_at').on(table.archivedAt),
  })
);

export const projectRemotes = sqliteTable(
  'project_remotes',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    remoteName: text('remote_name').notNull(),
    remoteUrl: text('remote_url').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.projectId, table.remoteName] }),
  })
);

export const projectSettings = sqliteTable('project_settings', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  baseProjectSettingsJson: text('base_project_settings_json').notNull().default('{}'),
  shareableProjectSettingsJson: text('shareable_project_settings_json').notNull().default('{}'),
  legacyConfigMigratedAt: text('legacy_config_migrated_at'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const appSettings = sqliteTable(
  'app_settings',
  {
    key: text('key').primaryKey(),
    value: text('value').notNull(),
    updatedAt: integer('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    keyIdx: uniqueIndex('idx_app_settings_key').on(table.key),
  })
);

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    status: text('status').notNull(),
    sourceBranch: text('source_branch', { mode: 'json' }).$type<StoredBranch>(),
    taskBranch: text('task_branch'),
    linkedIssue: text('linked_issue'),
    archivedAt: text('archived_at'), // null = active, timestamp = archived
    archiveNote: text('archive_note'),
    // Persisted archive intent: set when an archive is requested, before the
    // pre-archive command / conversation teardown runs. A task with this set
    // but archivedAt null is a crashed/interrupted archive — resumed at startup.
    archiveRequestedAt: text('archive_requested_at'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastInteractedAt: text('last_interacted_at'),
    statusChangedAt: text('status_changed_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    // Last computed diff totals for the task (source branch merge-base diff +
    // working tree). Snapshotted on status changes / agent exits / archive so
    // stats survive worktree removal.
    diffAdditions: integer('diff_additions'),
    diffDeletions: integer('diff_deletions'),
    diffCapturedAt: text('diff_captured_at'),
    isPinned: integer('is_pinned').notNull().default(0), // boolean, 0=false, 1=true
    needsReview: integer('needs_review').notNull().default(0), // boolean, 0=false, 1=true — surfaces a review marker in the UI
    isUserNamed: integer('is_user_named').notNull().default(0), // 1 if user manually renamed
    setupStatus: text('setup_status').notNull().default('ready'), // 'ready' | 'pending' | 'naming_failed' | 'branch_failed'
    setupError: text('setup_error'),
    setupData: text('setup_data'), // JSON needed to retry pre-provision setup after naming/branch failures
    workspaceProvider: text('workspace_provider'), // 'local' | 'ssh' | null (null = inherit from project settings)
    workspaceId: text('workspace_id'),
    workspaceProviderData: text('workspace_provider_data'), // JSON, BYOI only
    // Sidebar workspace (user-defined grouping tab) — distinct from the agent
    // runtime `workspaceId` above. Only meaningful for projectless Drafts tasks.
    sidebarWorkspaceId: text('sidebar_workspace_id').references(() => workspaces.id, {
      onDelete: 'set null',
    }),
    // Parent task for subtask trees. `set null` is only a DB-level safety net —
    // deleteTask reparents children to the grandparent before deleting.
    parentTaskId: text('parent_task_id').references((): AnySQLiteColumn => tasks.id, {
      onDelete: 'set null',
    }),
  },
  (table) => ({
    projectIdIdx: index('idx_tasks_project_id').on(table.projectId),
    sidebarWorkspaceIdIdx: index('idx_tasks_sidebar_workspace_id').on(table.sidebarWorkspaceId),
    parentTaskIdIdx: index('idx_tasks_parent_task_id').on(table.parentTaskId),
  })
);

export const taskNamingSnapshots = sqliteTable(
  'task_naming_snapshots',
  {
    taskId: text('task_id')
      .primaryKey()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    status: text('status').$type<TaskNamingStatus>().notNull(),
    model: text('model'),
    contextJson: text('context_json', { mode: 'json' }).$type<TaskNamingContextSnapshot>(),
    generatedTaskName: text('generated_task_name'),
    generatedBranchName: text('generated_branch_name'),
    error: text('error'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    projectIdIdx: index('idx_task_naming_snapshots_project_id').on(table.projectId),
  })
);

export const issueRecords = sqliteTable(
  'issues',
  {
    url: text('url').primaryKey(),
    provider: text('provider').notNull(),
    identifier: text('identifier').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    branchName: text('branch_name'),
    status: text('status'),
    assignees: text('assignees', { mode: 'json' }).$type<string[]>(),
    project: text('project'),
    updatedAt: text('updated_at'),
    fetchedAt: text('fetched_at'),
  },
  (table) => ({
    providerIdx: index('idx_issues_provider').on(table.provider),
    identifierIdx: index('idx_issues_identifier').on(table.identifier),
  })
);

export const taskIssueLinks = sqliteTable(
  'task_issues',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    issueUrl: text('issue_url')
      .notNull()
      .references(() => issueRecords.url, { onDelete: 'cascade' }),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.taskId, table.issueUrl] }),
    issueUrlIdx: index('idx_task_issues_issue_url').on(table.issueUrl),
  })
);

export const pullRequestUsers = sqliteTable('pull_request_users', {
  userId: text('user_id').primaryKey(),
  userName: text('user_name').notNull(),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  url: text('url'),

  userUpdatedAt: text('user_updated_at'),
  userCreatedAt: text('user_created_at'),
});

export const pullRequests = sqliteTable(
  'pull_requests',
  {
    url: text('url').primaryKey(),
    provider: text('provider').notNull().default('github'),
    repositoryUrl: text('repository_url').notNull(),

    baseRefName: text('base_ref_name').notNull(),
    baseRefOid: text('base_ref_oid').notNull(),

    headRepositoryUrl: text('head_repository_url').notNull(),
    headRefName: text('head_ref_name').notNull(),
    headRefOid: text('head_ref_oid').notNull(),

    identifier: text('identifier'), // #123 for github
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').notNull().default('open'),
    isDraft: integer('is_draft'),

    authorUserId: text('author_user_id').references(() => pullRequestUsers.userId, {
      onDelete: 'set null',
    }),

    additions: integer('additions'),
    deletions: integer('deletions'),
    changedFiles: integer('changed_files'),
    commitCount: integer('commit_count'),

    mergeableStatus: text('mergeable_status'),
    mergeStateStatus: text('merge_state_status'),
    reviewDecision: text('review_decision'),

    pullRequestCreatedAt: text('pull_request_created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    pullRequestUpdatedAt: text('pull_request_updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    urlIdx: uniqueIndex('idx_pull_requests_url').on(table.url),
    repositoryUrlIdx: index('idx_pull_requests_repository_url').on(table.repositoryUrl),
    headRepositoryUrlIdx: index('idx_pull_requests_head_repository_url').on(
      table.headRepositoryUrl
    ),
  })
);

export const pullRequestLabels = sqliteTable(
  'pull_request_labels',
  {
    pullRequestId: text('pull_request_id')
      .notNull()
      .references(() => pullRequests.url, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.pullRequestId, table.name] }),
    nameIdx: index('idx_prl_name').on(table.name),
  })
);

export const pullRequestAssignees = sqliteTable(
  'pull_request_assignees',
  {
    pullRequestUrl: text('pull_request_url')
      .notNull()
      .references(() => pullRequests.url, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => pullRequestUsers.userId, { onDelete: 'cascade' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.pullRequestUrl, table.userId] }),
    pullRequestUrlIdx: index('idx_pra_pull_request_url').on(table.pullRequestUrl),
    userIdIdx: index('idx_pra_user_id').on(table.userId),
  })
);

export const pullRequestChecks = sqliteTable(
  'pull_request_checks',
  {
    id: text('id').primaryKey(),
    pullRequestUrl: text('pull_request_url')
      .notNull()
      .references(() => pullRequests.url, { onDelete: 'cascade' }),
    commitSha: text('commit_sha').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull(),
    conclusion: text('conclusion').notNull(),

    detailsUrl: text('details_url'),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    workflowName: text('workflow_name'),
    appName: text('app_name'),
    appLogoUrl: text('app_logo_url'),
  },
  (table) => ({
    pullRequestUrlIdx: index('idx_prc_pull_request_url').on(table.pullRequestUrl),
  })
);

export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    // Who last set `title`: 'user' (manual rename), 'yoda' (our background
    // naming), 'agent' (provider CLI's own session title). Null = still the
    // initial title. Priority when writing: user > yoda > agent.
    titleSource: text('title_source').$type<'user' | 'yoda' | 'agent'>(),
    runtime: text('provider'),
    // Effective account mode at the last agent spawn — how this session's
    // tokens were paid for ('official-subscription' | 'official-api' | 'yoda-maas').
    authProvider: text('auth_provider').$type<AgentAccountProviderId>(),
    config: text('config'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    // Bumped on EVERY update to the row (rename, archive, interaction touch,
    // auth-provider snapshot, …) so it genuinely means "record last changed".
    // Runtime-only ($onUpdate), no migration involved.
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => new Date().toISOString()),
    lastInteractedAt: text('last_interacted_at'),
    isInitialConversation: integer('is_initial_conversation', { mode: 'boolean' }),
    archivedAt: text('archived_at'),
  },
  (table) => ({
    taskIdIdx: index('idx_conversations_task_id').on(table.taskId),
  })
);

export const terminals = sqliteTable(
  'terminals',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    ssh: integer('ssh').notNull().default(0), // boolean, 0=false, 1=true
    name: text('name').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    taskIdIdx: index('idx_terminals_task_id').on(table.taskId),
  })
);

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    sender: text('sender').notNull(),
    timestamp: text('timestamp')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    metadata: text('metadata'),
  },
  (table) => ({
    conversationIdIdx: index('idx_messages_conversation_id').on(table.conversationId),
    timestampIdx: index('idx_messages_timestamp').on(table.timestamp),
  })
);

export const editorBuffers = sqliteTable(
  'editor_buffers',
  {
    id: text('id').primaryKey(), // `${projectId}:${workspaceId}:${filePath}`
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').notNull(),
    filePath: text('file_path').notNull(),
    content: text('content').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => ({
    workspaceFileIdx: index('idx_editor_buffers_workspace_file').on(
      table.workspaceId,
      table.filePath
    ),
  })
);

export const agents = sqliteTable(
  'agents',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    icon: text('icon').notNull().default(''),
    systemPrompt: text('system_prompt').notNull().default(''),
    enabledSkillIds: text('enabled_skill_ids', { mode: 'json' })
      .notNull()
      .$type<string[]>()
      .default(sql`'[]'`),
    preferredRuntime: text('preferred_runtime_provider'), // RuntimeId | null
    model: text('model'),
    source: text('source').notNull().default('local'), // 'local' | 'imported'
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    slugIdx: uniqueIndex('idx_agents_slug').on(table.slug),
  })
);

export const kv = sqliteTable(
  'kv',
  {
    key: text('key').primaryKey(),
    value: text('value').notNull(),
    updatedAt: integer('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    keyIdx: uniqueIndex('idx_kv_key').on(table.key),
  })
);

export const appSecrets = sqliteTable(
  'app_secrets',
  {
    key: text('key').primaryKey(),
    secret: text('secret').notNull(),
  },
  (table) => ({
    keyIdx: uniqueIndex('idx_app_secrets_key').on(table.key),
  })
);

export const aiLabGenerations = sqliteTable(
  'ai_lab_generations',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull().default('logo'),
    brandName: text('brand_name').notNull(),
    description: text('description').notNull().default(''),
    styleId: text('style_id').notNull(),
    engine: text('engine').notNull(), // 'zenmux' | 'codex'
    model: text('model').notNull(),
    prompt: text('prompt').notNull(),
    status: text('status').notNull(), // 'succeeded' | 'failed'
    error: text('error'),
    // Image file names under the app's ai-lab/images directory.
    images: text('images', { mode: 'json' })
      .notNull()
      .$type<string[]>()
      .default(sql`'[]'`),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    createdAtIdx: index('idx_ai_lab_generations_created_at').on(table.createdAt),
  })
);

export const sshConnectionsRelations = relations(sshConnections, ({ many }) => ({
  projects: many(projects),
}));

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  projects: many(projects),
  tasks: many(tasks),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  tasks: many(tasks),
  settings: one(projectSettings, {
    fields: [projects.id],
    references: [projectSettings.projectId],
  }),
  sshConnection: one(sshConnections, {
    fields: [projects.sshConnectionId],
    references: [sshConnections.id],
  }),
  workspace: one(workspaces, {
    fields: [projects.workspaceId],
    references: [workspaces.id],
  }),
}));

export const projectSettingsRelations = relations(projectSettings, ({ one }) => ({
  project: one(projects, {
    fields: [projectSettings.projectId],
    references: [projects.id],
  }),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  conversations: many(conversations),
  issueLinks: many(taskIssueLinks),
}));

export const issueRecordsRelations = relations(issueRecords, ({ many }) => ({
  taskLinks: many(taskIssueLinks),
}));

export const taskIssueLinksRelations = relations(taskIssueLinks, ({ one }) => ({
  task: one(tasks, {
    fields: [taskIssueLinks.taskId],
    references: [tasks.id],
  }),
  issue: one(issueRecords, {
    fields: [taskIssueLinks.issueUrl],
    references: [issueRecords.url],
  }),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  task: one(tasks, {
    fields: [conversations.taskId],
    references: [tasks.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export type SshConnectionRow = typeof sshConnections.$inferSelect;
export type SshConnectionInsert = typeof sshConnections.$inferInsert;
export type WorkspaceRow = typeof workspaces.$inferSelect;
export type WorkspaceInsert = typeof workspaces.$inferInsert;
export type ProjectRow = typeof projects.$inferSelect;
export type ProjectSettingsRow = typeof projectSettings.$inferSelect;
export type ProjectSettingsInsert = typeof projectSettings.$inferInsert;
export type TaskRow = typeof tasks.$inferSelect;
export type TaskNamingSnapshotRow = typeof taskNamingSnapshots.$inferSelect;
export type IssueRecordRow = typeof issueRecords.$inferSelect;
export type IssueRecordInsert = typeof issueRecords.$inferInsert;
export type TaskIssueLinkRow = typeof taskIssueLinks.$inferSelect;
export type TaskIssueLinkInsert = typeof taskIssueLinks.$inferInsert;
export type ConversationRow = typeof conversations.$inferSelect;
export type TerminalRow = typeof terminals.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type EditorBufferRow = typeof editorBuffers.$inferSelect;
export type EditorBufferInsert = typeof editorBuffers.$inferInsert;
export type KvRow = typeof kv.$inferSelect;
export type KvInsert = typeof kv.$inferInsert;
export type AgentRow = typeof agents.$inferSelect;
export type AgentInsert = typeof agents.$inferInsert;
export type AppSecretRow = typeof appSecrets.$inferSelect;
export type AppSecretInsert = typeof appSecrets.$inferInsert;
