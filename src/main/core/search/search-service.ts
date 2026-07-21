import type { Conversation } from '@shared/conversations';
import type { Project } from '@shared/projects';
import type {
  CommandPalettePage,
  CommandPalettePagedQuery,
  CommandPaletteQuery,
  SearchItem,
  SearchItemKind,
} from '@shared/search';
import type { Task } from '@shared/tasks';
import { DEFAULT_WORKSPACE_ID } from '@shared/workspaces';
import { db, sqlite } from '@main/db/client';
import { projects, tasks } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { conversationEvents } from '../conversations/conversation-events';
import { projectEvents } from '../projects/project-events';
import { taskEvents } from '../tasks/task-events';

type FtsRow = {
  item_type: string;
  item_id: string;
  project_id: string | null;
  task_id: string | null;
  archived: string | null;
  title: string;
  rank: number;
};

type RecentTaskRow = {
  id: string;
  name: string;
  project_id: string;
};

type RecentConversationRow = {
  id: string;
  title: string;
  project_id: string;
  task_id: string;
};

type ConversationSearchMeta = {
  ts: string | null;
  conversationArchived: boolean;
  taskArchived: boolean;
};

/**
 * Effective sidebar workspace of a task: its own assignment (projectless Drafts)
 * falls back to the owning project's. Mirrors the renderer's sidebar filtering.
 */
const TASK_WORKSPACE_EXPR = 'COALESCE(wt.sidebar_workspace_id, wp.workspace_id)';

/**
 * SQL condition (with bind params) filtering `search_index` task rows to a
 * sidebar workspace. DEFAULT_WORKSPACE_ID means "no workspace assigned".
 * Non-task rows pass through untouched.
 */
function workspaceTaskCondition(workspaceId: string): { sql: string; params: string[] } {
  const cmp =
    workspaceId === DEFAULT_WORKSPACE_ID
      ? `${TASK_WORKSPACE_EXPR} IS NULL`
      : `${TASK_WORKSPACE_EXPR} = ?`;
  return {
    sql: `(item_type != 'task' OR EXISTS (
       SELECT 1 FROM tasks wt LEFT JOIN projects wp ON wt.project_id = wp.id
       WHERE wt.id = search_index.item_id AND ${cmp}))`,
    params: workspaceId === DEFAULT_WORKSPACE_ID ? [] : [workspaceId],
  };
}

function toSearchItem(r: FtsRow): SearchItem {
  return {
    kind: r.item_type as SearchItemKind,
    id: r.item_id,
    projectId: r.project_id,
    taskId: r.task_id,
    title: r.title,
    subtitle: '',
    score: r.rank,
    archived: r.archived === '1',
  };
}

export class SearchService {
  initialize(): void {
    taskEvents.on('task:created', (task) => this.upsertTask(task));
    taskEvents.on('task:updated', (task) => {
      this.upsertTask(task);
      this.refreshConversationArchiveFlagsForTask(task.id);
    });
    // Archived tasks stay indexed (marked archived) so search can still surface
    // them; restore emits task:updated, which re-upserts with archived cleared.
    taskEvents.on('task:archived', (taskId) => {
      this.markTaskArchived(taskId);
      this.markConversationsForTaskArchived(taskId);
    });
    taskEvents.on('task:deleted', (taskId) => this.removeByType('task', taskId));

    projectEvents.on('project:created', (project) => this.upsertProject(project));
    projectEvents.on('project:deleted', (projectId) => this.removeByType('project', projectId));
    projectEvents.on('project:archived', (projectId) => this.removeByType('project', projectId));
    projectEvents.on('project:unarchived', (project) => this.upsertProject(project));

    conversationEvents.on('conversation:created', (conversation) =>
      this.upsertConversation(conversation)
    );
    conversationEvents.on('conversation:renamed', (conversationId, projectId, taskId, newTitle) => {
      this.upsertConversationById(conversationId, projectId, taskId, newTitle);
    });
    conversationEvents.on('conversation:archived', (conversationId, projectId, taskId) =>
      this.upsertConversationById(conversationId, projectId, taskId)
    );
    conversationEvents.on('conversation:unarchived', (conversationId, projectId, taskId) =>
      this.upsertConversationById(conversationId, projectId, taskId)
    );
    conversationEvents.on('conversation:moved', (conversation) =>
      this.upsertConversation(conversation)
    );
    conversationEvents.on('conversation:deleted', (conversationId) =>
      this.removeByType('conversation', conversationId)
    );

    this.backfill();
  }

  search({ query, context }: CommandPaletteQuery): SearchItem[] {
    const trimmed = query.trim();
    if (!trimmed) return this.recents(context);

    const terms = trimmed.split(/[\s\-_]+/).filter(Boolean);

    // The trigram tokenizer indexes 3-char sliding windows, so it can match
    // substrings inside CJK words (e.g. "残影" inside "滚动残影") — but only for
    // terms of 3+ chars. Short terms (1-2 chars, common in CJK) have no trigram
    // to match, so those queries fall back to a LIKE substring scan.
    const trigramOk = terms.length > 0 && terms.every((t) => t.length >= 3);
    const rows = trigramOk ? this.searchFts(terms, context) : this.searchLike(trimmed, context);
    return this.attachTimestamps(rows);
  }

  /**
   * Fills in `timestamp` for FTS results. The search index has no time column,
   * so look each item's last-activity time up from its source table by id.
   */
  private attachTimestamps(items: SearchItem[]): SearchItem[] {
    if (items.length === 0) return items;

    const ids = { task: [] as string[], project: [] as string[], conversation: [] as string[] };
    for (const it of items) ids[it.kind].push(it.id);

    const ts = new Map<string, string | null>();
    const conversationMeta = new Map<string, ConversationSearchMeta>();
    const load = (kind: SearchItemKind, sql: string, idList: string[]) => {
      if (idList.length === 0) return;
      const placeholders = idList.map(() => '?').join(',');
      const rows = sqlite.prepare(sql.replace('@ids', placeholders)).all(...idList) as {
        id: string;
        ts: string | null;
      }[];
      for (const r of rows) ts.set(`${kind}:${r.id}`, r.ts);
    };
    try {
      load('task', `SELECT id, last_interacted_at AS ts FROM tasks WHERE id IN (@ids)`, ids.task);
      load('project', `SELECT id, updated_at AS ts FROM projects WHERE id IN (@ids)`, ids.project);
      load(
        'conversation',
        `SELECT id, last_interacted_at AS ts FROM conversations WHERE id IN (@ids)`,
        ids.conversation
      );
      if (ids.conversation.length > 0) {
        const placeholders = ids.conversation.map(() => '?').join(',');
        const rows = sqlite
          .prepare(
            `SELECT c.id,
                    c.last_interacted_at AS ts,
                    c.archived_at AS conversation_archived_at,
                    t.archived_at AS task_archived_at
             FROM conversations c
             LEFT JOIN tasks t ON c.task_id = t.id
             WHERE c.id IN (${placeholders})`
          )
          .all(...ids.conversation) as {
          id: string;
          ts: string | null;
          conversation_archived_at: string | null;
          task_archived_at: string | null;
        }[];
        for (const r of rows) {
          conversationMeta.set(r.id, {
            ts: r.ts,
            conversationArchived: r.conversation_archived_at != null,
            taskArchived: r.task_archived_at != null,
          });
        }
      }
    } catch (e) {
      log.warn('SearchService: attachTimestamps failed', { error: String(e) });
    }

    return items.map((it) => {
      if (it.kind !== 'conversation') {
        return { ...it, timestamp: ts.get(`${it.kind}:${it.id}`) ?? null };
      }
      const meta = conversationMeta.get(it.id);
      if (!meta) return { ...it, timestamp: ts.get(`${it.kind}:${it.id}`) ?? null };
      return {
        ...it,
        archived: it.archived || meta.conversationArchived || meta.taskArchived,
        conversationArchived: meta.conversationArchived,
        taskArchived: meta.taskArchived,
        timestamp: meta.ts,
      };
    });
  }

  /**
   * Paginated, single-kind query backing the scoped infinite-scroll views.
   * Empty query → recents for that kind; otherwise FTS/LIKE filtered to the kind.
   * Fetches limit+1 rows to detect whether another page exists.
   */
  searchPaged({
    query,
    kind,
    offset,
    limit,
    context,
  }: CommandPalettePagedQuery): CommandPalettePage {
    const probe = limit + 1;
    const trimmed = query.trim();
    const rows = trimmed
      ? this.attachTimestamps(this.searchKindPaged(trimmed, kind, context, probe, offset))
      : this.recentsForKind(kind, context, probe, offset);

    const hasMore = rows.length > limit;
    return { items: rows.slice(0, limit), nextOffset: hasMore ? offset + limit : null };
  }

  private recentsForKind(
    kind: SearchItemKind,
    context: CommandPaletteQuery['context'],
    limit: number,
    offset: number
  ): SearchItem[] {
    if (kind === 'task') return this.recentTasks(context, limit, offset);
    if (kind === 'project') return this.recentProjects(limit, offset);
    return this.recentConversations(context, limit, offset);
  }

  /**
   * Kind-scoped typed search (FTS for 3+ char terms, LIKE fallback otherwise)
   * with native LIMIT/OFFSET so pagination is correct per kind.
   */
  private searchKindPaged(
    query: string,
    kind: SearchItemKind,
    context: CommandPaletteQuery['context'],
    limit: number,
    offset: number
  ): SearchItem[] {
    const terms = query.split(/[\s\-_]+/).filter(Boolean);
    const trigramOk = terms.length > 0 && terms.every((t) => t.length >= 3);
    // Conversations are only matched within the current task, mirroring search().
    const convScoped = kind === 'conversation' && context?.taskId;
    const ws =
      kind === 'task' && context?.workspaceId ? workspaceTaskCondition(context.workspaceId) : null;

    const extraSql = `${convScoped ? 'AND task_id = ?' : ''} ${ws ? `AND ${ws.sql}` : ''}`;
    const extraParams = [...(convScoped ? [context!.taskId!] : []), ...(ws ? ws.params : [])];

    try {
      if (trigramOk) {
        const ftsQuery = terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(' AND ');
        const rows = sqlite
          .prepare(
            `SELECT item_type, item_id, project_id, task_id, archived, title, bm25(search_index) AS rank
             FROM search_index
             WHERE search_index MATCH ? AND item_type = ? ${extraSql}
             ORDER BY archived, rank LIMIT ? OFFSET ?`
          )
          .all(ftsQuery, kind, ...extraParams, limit, offset) as FtsRow[];
        return rows.map(toSearchItem);
      }

      const like = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
      const rows = sqlite
        .prepare(
          `SELECT item_type, item_id, project_id, task_id, archived, title, 0 AS rank
           FROM search_index
           WHERE (title LIKE ? ESCAPE '\\' OR keywords LIKE ? ESCAPE '\\')
             AND item_type = ? ${extraSql}
           ORDER BY archived LIMIT ? OFFSET ?`
        )
        .all(like, like, kind, ...extraParams, limit, offset) as FtsRow[];
      return rows.map(toSearchItem);
    } catch (e) {
      log.warn('SearchService: searchKindPaged failed', { kind, error: String(e) });
      return [];
    }
  }

  /** Trigram FTS5 search with BM25 ranking. Each term must be 3+ chars. */
  private searchFts(terms: string[], context?: CommandPaletteQuery['context']): SearchItem[] {
    // Quote each term so trigram treats it as a literal substring and FTS5
    // operators inside the term (-, ", *) are not interpreted as query syntax.
    const ftsQuery = terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(' AND ');
    const convSql = context?.taskId
      ? `AND (item_type != 'conversation' OR task_id = ?)`
      : `AND item_type != 'conversation'`;
    const ws = context?.workspaceId ? workspaceTaskCondition(context.workspaceId) : null;

    try {
      const rows = sqlite
        .prepare(
          `SELECT item_type, item_id, project_id, task_id, archived, title, bm25(search_index) AS rank
           FROM search_index
           WHERE search_index MATCH ?
             ${convSql}
             ${ws ? `AND ${ws.sql}` : ''}
           ORDER BY archived, rank
           LIMIT 30`
        )
        .all(
          ftsQuery,
          ...(context?.taskId ? [context.taskId] : []),
          ...(ws ? ws.params : [])
        ) as FtsRow[];
      return rows.map(toSearchItem);
    } catch (e) {
      log.warn('SearchService: FTS query failed', { terms, error: String(e) });
      return [];
    }
  }

  /** Substring fallback for short (1-2 char) queries the trigram index can't serve. */
  private searchLike(needle: string, context?: CommandPaletteQuery['context']): SearchItem[] {
    const like = `%${needle.replace(/[\\%_]/g, '\\$&')}%`;
    const convSql = context?.taskId
      ? `AND (item_type != 'conversation' OR task_id = ?)`
      : `AND item_type != 'conversation'`;
    const ws = context?.workspaceId ? workspaceTaskCondition(context.workspaceId) : null;
    try {
      const rows = sqlite
        .prepare(
          `SELECT item_type, item_id, project_id, task_id, archived, title, 0 AS rank
           FROM search_index
           WHERE (title LIKE ? ESCAPE '\\' OR keywords LIKE ? ESCAPE '\\')
             ${convSql}
             ${ws ? `AND ${ws.sql}` : ''}
           ORDER BY archived
           LIMIT 30`
        )
        .all(
          like,
          like,
          ...(context?.taskId ? [context.taskId] : []),
          ...(ws ? ws.params : [])
        ) as FtsRow[];
      return rows.map(toSearchItem);
    } catch (e) {
      log.warn('SearchService: LIKE query failed', { needle, error: String(e) });
      return [];
    }
  }

  private recents(context?: CommandPaletteQuery['context']): SearchItem[] {
    // Same per-category preview size so the "all" overview is balanced across
    // kinds (the scoped chips give the full, infinite-scroll list per kind).
    const PREVIEW = 8;
    const results: SearchItem[] = [];
    // Guard each source independently so one failing query can't blank the list.
    try {
      results.push(...this.recentTasks(context, PREVIEW));
    } catch (e) {
      log.warn('SearchService: recentTasks failed', { error: String(e) });
    }
    try {
      results.push(...this.recentProjects(PREVIEW));
    } catch (e) {
      log.warn('SearchService: recentProjects failed', { error: String(e) });
    }
    try {
      results.push(...this.recentConversations(context, PREVIEW));
    } catch (e) {
      log.warn('SearchService: recentConversations failed', { error: String(e) });
    }
    return results;
  }

  /** Recent tasks — active first, then archived (both surfaced). */
  private recentTasks(
    context?: CommandPaletteQuery['context'],
    limit = 10,
    offset = 0
  ): SearchItem[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    if (context?.projectId) {
      conditions.push('t.project_id = ?');
      params.push(context.projectId);
    }
    if (context?.workspaceId) {
      // Effective workspace mirrors workspaceTaskCondition: task assignment
      // (projectless Drafts) falls back to the owning project's.
      const effective = 'COALESCE(t.sidebar_workspace_id, p.workspace_id)';
      if (context.workspaceId === DEFAULT_WORKSPACE_ID) {
        conditions.push(`${effective} IS NULL`);
      } else {
        conditions.push(`${effective} = ?`);
        params.push(context.workspaceId);
      }
    }

    const taskRows = sqlite
      .prepare(
        `SELECT t.id, t.name, t.project_id, t.archived_at, t.last_interacted_at
         FROM tasks t
         LEFT JOIN projects p ON t.project_id = p.id
         ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
         ORDER BY (t.archived_at IS NOT NULL), t.last_interacted_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as (RecentTaskRow & {
      archived_at: string | null;
      last_interacted_at: string | null;
    })[];

    return taskRows.map((r) => ({
      kind: 'task' as const,
      id: r.id,
      projectId: r.project_id,
      taskId: null,
      title: r.name,
      subtitle: '',
      score: 0,
      archived: r.archived_at != null,
      timestamp: r.last_interacted_at,
    }));
  }

  /** Recent projects — active first, then archived. Internal projects are hidden. */
  private recentProjects(limit = 8, offset = 0): SearchItem[] {
    const rows = sqlite
      .prepare(
        `SELECT p.id, p.name, p.archived_at, p.updated_at
         FROM projects p
         WHERE p.is_internal = 0
         ORDER BY (p.archived_at IS NOT NULL), p.updated_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as {
      id: string;
      name: string;
      archived_at: string | null;
      updated_at: string | null;
    }[];

    return rows.map((r) => ({
      kind: 'project' as const,
      id: r.id,
      projectId: null,
      taskId: null,
      title: r.name,
      subtitle: '',
      score: 0,
      archived: r.archived_at != null,
      timestamp: r.updated_at,
    }));
  }

  /**
   * Recent conversations. Scoped to the current task when one is open, otherwise
   * the most recent conversations across all tasks. Archived conversations stay
   * visible and sort after active ones so completed work remains findable.
   */
  private recentConversations(
    context?: CommandPaletteQuery['context'],
    limit = 10,
    offset = 0
  ): SearchItem[] {
    // The JOIN drops orphans whose task row no longer exists.
    const rows = (
      context?.taskId
        ? sqlite
            .prepare(
              `SELECT c.id, c.title, c.project_id, c.task_id, c.last_interacted_at,
                      c.archived_at AS conversation_archived_at,
                      t.archived_at AS task_archived_at
               FROM conversations c
               INNER JOIN tasks t ON c.task_id = t.id
               WHERE c.task_id = ?
               ORDER BY (c.archived_at IS NOT NULL OR t.archived_at IS NOT NULL),
                        c.last_interacted_at DESC
               LIMIT ? OFFSET ?`
            )
            .all(context.taskId, limit, offset)
        : sqlite
            .prepare(
              `SELECT c.id, c.title, c.project_id, c.task_id, c.last_interacted_at,
                      c.archived_at AS conversation_archived_at,
                      t.archived_at AS task_archived_at
               FROM conversations c
               INNER JOIN tasks t ON c.task_id = t.id
               ORDER BY (c.archived_at IS NOT NULL OR t.archived_at IS NOT NULL),
                        c.last_interacted_at DESC
               LIMIT ? OFFSET ?`
            )
            .all(limit, offset)
    ) as (RecentConversationRow & {
      last_interacted_at: string | null;
      conversation_archived_at: string | null;
      task_archived_at: string | null;
    })[];

    return rows.map((r) => ({
      kind: 'conversation' as const,
      id: r.id,
      projectId: r.project_id,
      taskId: r.task_id,
      title: r.title,
      subtitle: '',
      score: 0,
      timestamp: r.last_interacted_at,
      archived: r.conversation_archived_at != null || r.task_archived_at != null,
      conversationArchived: r.conversation_archived_at != null,
      taskArchived: r.task_archived_at != null,
    }));
  }

  private upsertTask(task: Task): void {
    const linkedIssues = task.linkedIssues ?? (task.linkedIssue ? [task.linkedIssue] : []);
    const issueKeywords = linkedIssues.flatMap((issue) => [issue.identifier, issue.title]);
    const keywords = [task.taskBranch, ...issueKeywords].filter(Boolean).join(' ');
    const archived = task.archivedAt ? '1' : '';

    try {
      sqlite
        .prepare(
          `INSERT OR REPLACE INTO search_index(item_type, item_id, project_id, task_id, archived, title, keywords)
           VALUES ('task', ?, ?, NULL, ?, ?, ?)`
        )
        .run(task.id, task.projectId, archived, task.name, keywords);
    } catch (e) {
      log.warn('SearchService: upsertTask failed', { taskId: task.id, error: String(e) });
    }
  }

  /** Flips an existing indexed task to archived without re-deriving its row. */
  private markTaskArchived(taskId: string): void {
    try {
      sqlite
        .prepare(`UPDATE search_index SET archived = '1' WHERE item_id = ? AND item_type = 'task'`)
        .run(taskId);
    } catch (e) {
      log.warn('SearchService: markTaskArchived failed', { taskId, error: String(e) });
    }
  }

  private upsertProject(project: Project): void {
    try {
      sqlite
        .prepare(
          `INSERT OR REPLACE INTO search_index(item_type, item_id, project_id, task_id, archived, title, keywords)
           VALUES ('project', ?, NULL, NULL, '', ?, ?)`
        )
        .run(project.id, project.name, project.path);
    } catch (e) {
      log.warn('SearchService: upsertProject failed', {
        projectId: project.id,
        error: String(e),
      });
    }
  }

  private upsertConversation(conversation: Conversation): void {
    try {
      const taskRow = sqlite
        .prepare(`SELECT archived_at FROM tasks WHERE id = ? LIMIT 1`)
        .get(conversation.taskId) as { archived_at: string | null } | undefined;
      const archived = conversation.archivedAt || taskRow?.archived_at ? '1' : '';
      this.removeByType('conversation', conversation.id);
      sqlite
        .prepare(
          `INSERT OR REPLACE INTO search_index(item_type, item_id, project_id, task_id, archived, title, keywords)
           VALUES ('conversation', ?, ?, ?, ?, ?, '')`
        )
        .run(
          conversation.id,
          conversation.projectId,
          conversation.taskId,
          archived,
          conversation.title
        );
    } catch (e) {
      log.warn('SearchService: upsertConversation failed', {
        conversationId: conversation.id,
        error: String(e),
      });
    }
  }

  private upsertConversationById(
    conversationId: string,
    projectId: string,
    taskId: string,
    title?: string
  ): void {
    try {
      const row = sqlite
        .prepare(
          `SELECT c.title,
                  c.archived_at AS conversation_archived_at,
                  t.archived_at AS task_archived_at
           FROM conversations c
           INNER JOIN tasks t ON c.task_id = t.id
           WHERE c.id = ?
           LIMIT 1`
        )
        .get(conversationId) as
        | {
            title: string;
            conversation_archived_at: string | null;
            task_archived_at: string | null;
          }
        | undefined;
      if (!row) {
        this.removeByType('conversation', conversationId);
        return;
      }

      const archived = row.conversation_archived_at || row.task_archived_at ? '1' : '';
      this.removeByType('conversation', conversationId);
      sqlite
        .prepare(
          `INSERT OR REPLACE INTO search_index(item_type, item_id, project_id, task_id, archived, title, keywords)
           VALUES ('conversation', ?, ?, ?, ?, ?, '')`
        )
        .run(conversationId, projectId, taskId, archived, title || row.title);
    } catch (e) {
      log.warn('SearchService: upsertConversationById failed', {
        conversationId,
        error: String(e),
      });
    }
  }

  private removeByType(itemType: string, itemId: string): void {
    try {
      sqlite
        .prepare(`DELETE FROM search_index WHERE item_id = ? AND item_type = ?`)
        .run(itemId, itemType);
    } catch (e) {
      log.warn('SearchService: removeByType failed', { itemType, itemId, error: String(e) });
    }
  }

  private markConversationsForTaskArchived(taskId: string): void {
    try {
      sqlite
        .prepare(
          `UPDATE search_index SET archived = '1' WHERE item_type = 'conversation' AND task_id = ?`
        )
        .run(taskId);
    } catch (e) {
      log.warn('SearchService: markConversationsForTaskArchived failed', {
        taskId,
        error: String(e),
      });
    }
  }

  private refreshConversationArchiveFlagsForTask(taskId: string): void {
    try {
      const rows = sqlite
        .prepare(
          `SELECT c.id,
                  c.project_id,
                  c.task_id,
                  c.title,
                  c.archived_at AS conversation_archived_at,
                  t.archived_at AS task_archived_at
           FROM conversations c
           INNER JOIN tasks t ON c.task_id = t.id
           WHERE c.task_id = ?`
        )
        .all(taskId) as (RecentConversationRow & {
        conversation_archived_at: string | null;
        task_archived_at: string | null;
      })[];

      const upsertStmt = sqlite.prepare(
        `INSERT OR REPLACE INTO search_index(item_type, item_id, project_id, task_id, archived, title, keywords)
         VALUES ('conversation', ?, ?, ?, ?, ?, '')`
      );
      sqlite.transaction(() => {
        sqlite
          .prepare(`DELETE FROM search_index WHERE item_type = 'conversation' AND task_id = ?`)
          .run(taskId);
        for (const row of rows) {
          const archived = row.conversation_archived_at || row.task_archived_at ? '1' : '';
          upsertStmt.run(row.id, row.project_id, row.task_id, archived, row.title);
        }
      })();
    } catch (e) {
      log.warn('SearchService: refreshConversationArchiveFlagsForTask failed', {
        taskId,
        error: String(e),
      });
    }
  }

  private backfill(): void {
    try {
      const count = (
        sqlite.prepare(`SELECT count(*) as n FROM search_index`).get() as { n: number }
      ).n;

      if (count > 0) return;

      const allTasks = db.select().from(tasks).all();
      const allProjects = db.select().from(projects).all();
      const allConversations = sqlite
        .prepare(
          `SELECT c.id,
                  c.project_id,
                  c.task_id,
                  c.title,
                  c.archived_at AS conversation_archived_at,
                  t.archived_at AS task_archived_at
           FROM conversations c
           INNER JOIN tasks t ON c.task_id = t.id`
        )
        .all() as (RecentConversationRow & {
        conversation_archived_at: string | null;
        task_archived_at: string | null;
      })[];

      const upsertStmt = sqlite.prepare(
        `INSERT OR REPLACE INTO search_index(item_type, item_id, project_id, task_id, archived, title, keywords)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );

      sqlite.transaction(() => {
        // Archived tasks stay indexed (flagged) so search can surface them.
        for (const t of allTasks) {
          upsertStmt.run(
            'task',
            t.id,
            t.projectId,
            null,
            t.archivedAt ? '1' : '',
            t.name,
            t.taskBranch ?? ''
          );
        }
        for (const p of allProjects) {
          if (p.archivedAt) continue;
          upsertStmt.run('project', p.id, null, null, '', p.name, p.path);
        }
        for (const c of allConversations) {
          const archived = c.conversation_archived_at || c.task_archived_at ? '1' : '';
          upsertStmt.run('conversation', c.id, c.project_id, c.task_id, archived, c.title, '');
        }
      })();

      log.info('SearchService: backfilled search index', {
        tasks: allTasks.length,
        projects: allProjects.filter((p) => !p.archivedAt).length,
        conversations: allConversations.length,
      });
    } catch (e) {
      log.warn('SearchService: backfill failed', { error: String(e) });
    }
  }
}

export const searchService = new SearchService();
