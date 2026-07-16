import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@main/db/schema';

const state = vi.hoisted(() => ({
  db: null as unknown,
  emit: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  get db() {
    return state.db;
  },
}));

vi.mock('@main/lib/events', () => ({
  events: { emit: state.emit },
}));

describe('FeatureService', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    vi.resetModules();
    state.emit.mockReset();
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    createSchema(sqlite);
    seedProjectsAndTasks(sqlite);
    state.db = drizzle(sqlite, { schema });
  });

  afterEach(() => {
    sqlite.close();
    state.db = null;
  });

  it('creates an auditable Feature linked to its source issue', async () => {
    const { FeatureService } = await import('./feature-service');
    const service = new FeatureService();
    const feature = await service.create({
      projectId: 'project-1',
      title: 'Feature delivery workflow',
      problem: 'Feature work loses its design and documentation context.',
      sourceIssues: [
        {
          provider: 'github',
          url: 'https://github.com/lovstudio/yoda/issues/1',
          identifier: '#1',
          title: 'Feature delivery workflow',
        },
      ],
    });

    expect(feature).toMatchObject({
      projectId: 'project-1',
      stage: 'problem',
      status: 'active',
      sourceIssues: [{ identifier: '#1' }],
      gate: { canAdvance: true, nextStage: 'design' },
    });
    expect(feature.events.map((event) => event.type)).toEqual(['created']);
    expect(await service.list('project-1')).toEqual([
      expect.objectContaining({
        id: feature.id,
        sourceIssueUrls: ['https://github.com/lovstudio/yoda/issues/1'],
      }),
    ]);

    const duplicate = await service.create({
      projectId: 'project-1',
      title: 'Duplicate attempt',
      problem: 'The same source Issue should not fork the delivery record.',
      sourceIssues: feature.sourceIssues,
    });
    expect(duplicate.id).toBe(feature.id);
    expect(await service.list('project-1')).toHaveLength(1);
  });

  it('enforces artifact approvals before a stage transition', async () => {
    const { FeatureService } = await import('./feature-service');
    const service = new FeatureService();
    const created = await service.create({
      projectId: 'project-1',
      title: 'Feature delivery workflow',
      problem: 'The workflow is fragmented.',
    });

    expect((await service.advance('project-1', created.id)).success).toBe(true);
    const blocked = await service.advance('project-1', created.id);
    expect(blocked).toMatchObject({
      success: false,
      error: {
        type: 'gate_blocked',
        gate: {
          canAdvance: false,
          blockers: [
            { code: 'artifact_missing', artifactType: 'product_spec' },
            { code: 'artifact_missing', artifactType: 'ux_design' },
            { code: 'artifact_missing', artifactType: 'acceptance_criteria' },
          ],
        },
      },
    });

    await service.addArtifact('project-1', created.id, {
      type: 'product_spec',
      title: 'Product spec',
      uri: 'docs/product/feature.md',
      status: 'approved',
    });
    await service.addArtifact('project-1', created.id, {
      type: 'ux_design',
      title: 'UX design',
      uri: 'docs/product/feature.md#ux',
      status: 'approved',
    });
    const withAcceptanceCriteria = await service.addArtifact('project-1', created.id, {
      type: 'acceptance_criteria',
      title: 'Acceptance criteria',
      uri: 'docs/product/feature.md#ac',
      status: 'draft',
    });
    expect(withAcceptanceCriteria.success).toBe(true);
    if (!withAcceptanceCriteria.success) return;
    const acceptanceCriteria = withAcceptanceCriteria.data.artifacts.find(
      (artifact) => artifact.type === 'acceptance_criteria'
    );
    expect(acceptanceCriteria).toBeDefined();

    await service.updateArtifact('project-1', created.id, acceptanceCriteria!.id, {
      status: 'approved',
    });
    const advanced = await service.advance('project-1', created.id);
    expect(advanced).toMatchObject({ success: true, data: { stage: 'planning' } });
  });

  it('requires linked tasks to reach review before verification', async () => {
    const { FeatureService } = await import('./feature-service');
    const service = new FeatureService();
    const feature = await service.create({
      projectId: 'project-1',
      title: 'Feature delivery workflow',
      problem: 'The workflow is fragmented.',
    });
    await service.advance('project-1', feature.id);
    await service.addArtifact('project-1', feature.id, {
      type: 'product_spec',
      title: 'Product spec',
      uri: 'docs/product/feature.md',
      status: 'approved',
    });
    await service.addArtifact('project-1', feature.id, {
      type: 'ux_design',
      title: 'UX design',
      uri: 'docs/product/feature.md#ux',
      status: 'approved',
    });
    await service.addArtifact('project-1', feature.id, {
      type: 'acceptance_criteria',
      title: 'Acceptance criteria',
      uri: 'docs/product/feature.md#ac',
      status: 'approved',
    });
    await service.advance('project-1', feature.id);
    await service.addArtifact('project-1', feature.id, {
      type: 'technical_plan',
      title: 'Technical plan',
      uri: 'docs/plans/feature.md',
      status: 'approved',
    });
    await service.advance('project-1', feature.id);

    expect(await service.setTaskLinked('project-1', feature.id, 'other-task', true)).toEqual({
      success: false,
      error: { type: 'cross_project_task' },
    });
    await service.setTaskLinked('project-1', feature.id, 'task-1', true);
    expect(await service.advance('project-1', feature.id)).toMatchObject({
      success: false,
      error: { type: 'gate_blocked' },
    });

    sqlite.prepare(`UPDATE tasks SET status = 'review' WHERE id = 'task-1'`).run();
    expect(await service.advance('project-1', feature.id)).toMatchObject({
      success: true,
      data: { stage: 'verification' },
    });
  });

  it('reopens a completed Feature only through a stage retreat', async () => {
    const { FeatureService } = await import('./feature-service');
    const service = new FeatureService();
    const feature = await service.create({
      projectId: 'project-1',
      title: 'Completed workflow',
      problem: 'Completion state must stay consistent with the stage.',
    });
    sqlite
      .prepare(`UPDATE features SET stage = 'done', status = 'completed' WHERE id = ?`)
      .run(feature.id);

    expect(await service.update('project-1', feature.id, { status: 'active' })).toMatchObject({
      stage: 'done',
      status: 'completed',
    });
    expect(await service.retreat('project-1', feature.id)).toMatchObject({
      success: true,
      data: { stage: 'release', status: 'active' },
    });
  });

  it('atomically creates and links one workflow Feature for concurrent Task starts', async () => {
    sqlite.exec(`
      INSERT INTO issues (url, provider, identifier, title)
      VALUES ('https://github.com/lovstudio/yoda/issues/42', 'github', '#42', 'Governed workflow');
      INSERT INTO task_issues (task_id, issue_url)
      VALUES ('task-1', 'https://github.com/lovstudio/yoda/issues/42');
    `);
    const { FeatureService } = await import('./feature-service');
    const service = new FeatureService();

    const [first, second] = await Promise.all([
      service.ensureForTask('project-1', 'task-1', 'Feature delivery needs one source of truth.'),
      service.ensureForTask('project-1', 'task-1', 'A retry must reuse the same Feature.'),
    ]);

    expect(second.id).toBe(first.id);
    expect(first.tasks.map((task) => task.taskId)).toEqual(['task-1']);
    expect(first.sourceIssues.map((issue) => issue.identifier)).toEqual(['#42']);
    expect(first.events.filter((event) => event.type === 'task_linked')).toHaveLength(1);
    expect(first.events.every((event) => event.actorType === 'agent')).toBe(true);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM features').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM feature_workflow_owners').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM feature_tasks').get()).toEqual({
      count: 1,
    });
  });

  it('protects an active workflow Room from Task unlink races', async () => {
    const { FeatureService } = await import('./feature-service');
    const service = new FeatureService();
    const feature = await service.ensureForTask(
      'project-1',
      'task-1',
      'The Room and Feature must remain linked.'
    );
    sqlite
      .prepare(
        `INSERT INTO team_rooms
          (id, project_id, task_id, feature_id, name, preset, status, routing_hop_limit)
         VALUES ('room-1', 'project-1', 'task-1', ?, 'Feature', 'feature-workflow', 'active', 100)`
      )
      .run(feature.id);

    expect(await service.setTaskLinked('project-1', feature.id, 'task-1', false)).toEqual({
      success: false,
      error: { type: 'active_workflow_room', roomId: 'room-1' },
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM feature_tasks').get()).toEqual({
      count: 1,
    });

    sqlite.prepare(`UPDATE team_rooms SET status = 'archived' WHERE id = 'room-1'`).run();
    expect(await service.setTaskLinked('project-1', feature.id, 'task-1', false)).toMatchObject({
      success: true,
      data: { tasks: [] },
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM feature_workflow_owners').get()).toEqual({
      count: 0,
    });
  });

  it('allows only one active Feature workflow Room per project Task', () => {
    const insert = sqlite.prepare(
      `INSERT INTO team_rooms
        (id, project_id, task_id, feature_id, name, preset, status, routing_hop_limit)
       VALUES (?, 'project-1', 'task-1', NULL, 'Feature', 'feature-workflow', 'active', 100)`
    );
    insert.run('room-1');
    expect(() => insert.run('room-2')).toThrow();
    sqlite.prepare(`UPDATE team_rooms SET status = 'archived' WHERE id = 'room-1'`).run();
    expect(() => insert.run('room-2')).not.toThrow();
  });

  it('records agent proposals as drafts with provenance and stales old approval', async () => {
    const { FeatureService } = await import('./feature-service');
    const service = new FeatureService();
    const feature = await service.create({
      projectId: 'project-1',
      title: 'Proposal ingestion',
      problem: 'Agent evidence needs explicit review.',
    });
    await service.setTaskLinked('project-1', feature.id, 'task-1', true);
    await service.advance('project-1', feature.id);
    await service.addArtifact('project-1', feature.id, {
      type: 'product_spec',
      title: 'Old approved spec',
      uri: 'docs/old.md',
      status: 'approved',
    });

    const proposed = await service.proposeArtifacts(
      'project-1',
      feature.id,
      [
        { type: 'product_spec', title: 'New spec', uri: 'docs/design.md' },
        { type: 'ux_design', title: 'UX', uri: 'docs/design.md' },
        {
          type: 'acceptance_criteria',
          title: 'Acceptance criteria',
          uri: 'docs/design.md',
        },
      ],
      {
        taskId: 'task-1',
        roomId: 'room-1',
        messageId: 'message-1',
        memberId: 'member-product-design',
        stage: 'design',
        verdict: 'ready',
        evidence: 'Design criteria checked.',
      }
    );

    expect(
      proposed.artifacts.find((artifact) => artifact.title === 'Old approved spec')
    ).toMatchObject({ status: 'stale' });
    expect(
      proposed.artifacts.filter((artifact) => artifact.sourceMessageId === 'message-1')
    ).toHaveLength(3);
    expect(
      proposed.artifacts
        .filter((artifact) => artifact.sourceMessageId === 'message-1')
        .every((artifact) => artifact.status === 'draft' && artifact.sourceTaskId === 'task-1')
    ).toBe(true);
    expect(proposed.events.find((event) => event.type === 'handoff_recorded')).toMatchObject({
      actorType: 'agent',
      payload: { messageId: 'message-1' },
    });
  });

  it.each(['blocked', 'cancelled', 'completed'] as const)(
    'rejects agent evidence transactionally when the Feature is %s',
    async (status) => {
      const { FeatureService } = await import('./feature-service');
      const service = new FeatureService();
      const feature = await service.create({
        projectId: 'project-1',
        title: 'Late hand-off guard',
        problem: 'Cancelled work must not mutate evidence.',
      });
      await service.setTaskLinked('project-1', feature.id, 'task-1', true);
      sqlite
        .prepare(`UPDATE features SET stage = 'design', status = ? WHERE id = ?`)
        .run(status, feature.id);
      const before = {
        artifacts: sqlite.prepare('SELECT COUNT(*) AS count FROM feature_artifacts').get(),
        events: sqlite.prepare('SELECT COUNT(*) AS count FROM feature_events').get(),
      };

      await expect(
        service.proposeArtifacts(
          'project-1',
          feature.id,
          [{ type: 'product_spec', title: 'Late spec', uri: 'docs/late.md' }],
          {
            taskId: 'task-1',
            roomId: 'room-1',
            messageId: `message-${status}`,
            memberId: 'member-product-design',
            stage: 'design',
            verdict: 'ready',
            evidence: 'Late result.',
          }
        )
      ).rejects.toThrow('agent evidence is paused');
      expect({
        artifacts: sqlite.prepare('SELECT COUNT(*) AS count FROM feature_artifacts').get(),
        events: sqlite.prepare('SELECT COUNT(*) AS count FROM feature_events').get(),
      }).toEqual(before);
    }
  );

  it('rejects a stale-stage hand-off before writing an event', async () => {
    const { FeatureService } = await import('./feature-service');
    const service = new FeatureService();
    const feature = await service.create({
      projectId: 'project-1',
      title: 'Stage race guard',
      problem: 'Old replies must not land in a new stage.',
    });
    await service.setTaskLinked('project-1', feature.id, 'task-1', true);
    sqlite.prepare(`UPDATE features SET stage = 'planning' WHERE id = ?`).run(feature.id);
    const before = sqlite.prepare('SELECT COUNT(*) AS count FROM feature_events').get();

    await expect(
      service.recordHandoff('project-1', feature.id, {
        taskId: 'task-1',
        roomId: 'room-1',
        messageId: 'message-old-design',
        memberId: 'member-product-design',
        stage: 'design',
        verdict: 'ready',
        evidence: 'Old stage.',
      })
    ).rejects.toThrow('moved from design to planning');
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM feature_events').get()).toEqual(before);
  });

  it('keeps Task status unchanged when cancellation wins the implementation race', async () => {
    const { FeatureService } = await import('./feature-service');
    const { updateTaskStatusForActiveFeatureHandoff } = await import(
      '@main/core/tasks/operations/updateTaskStatus'
    );
    const service = new FeatureService();
    const feature = await service.create({
      projectId: 'project-1',
      title: 'Task transition race guard',
      problem: 'Cancellation must win over an in-flight Agent reply.',
    });
    await service.setTaskLinked('project-1', feature.id, 'task-1', true);
    sqlite
      .prepare(`UPDATE features SET stage = 'implementation', status = 'cancelled' WHERE id = ?`)
      .run(feature.id);

    await expect(
      updateTaskStatusForActiveFeatureHandoff({
        projectId: 'project-1',
        featureId: feature.id,
        featureStage: 'implementation',
        taskId: 'task-1',
        status: 'review',
      })
    ).rejects.toThrow('Feature changed');
    expect(sqlite.prepare(`SELECT status FROM tasks WHERE id = 'task-1'`).get()).toEqual({
      status: 'in_progress',
    });
  }, 15_000);

  it('does not regress a concurrently completed Task back to review', async () => {
    const { FeatureService } = await import('./feature-service');
    const { updateTaskStatusForActiveFeatureHandoff } = await import(
      '@main/core/tasks/operations/updateTaskStatus'
    );
    const service = new FeatureService();
    const feature = await service.create({
      projectId: 'project-1',
      title: 'Completed Task race guard',
      problem: 'A late hand-off must preserve a newer done state.',
    });
    await service.setTaskLinked('project-1', feature.id, 'task-1', true);
    sqlite.prepare(`UPDATE features SET stage = 'implementation' WHERE id = ?`).run(feature.id);
    sqlite.prepare(`UPDATE tasks SET status = 'done' WHERE id = 'task-1'`).run();

    await expect(
      updateTaskStatusForActiveFeatureHandoff({
        projectId: 'project-1',
        featureId: feature.id,
        featureStage: 'implementation',
        taskId: 'task-1',
        status: 'review',
      })
    ).resolves.toBe(false);
    expect(sqlite.prepare(`SELECT status FROM tasks WHERE id = 'task-1'`).get()).toEqual({
      status: 'done',
    });
  });
});

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id),
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE TABLE issues (
      url TEXT PRIMARY KEY NOT NULL,
      provider TEXT NOT NULL,
      identifier TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      branch_name TEXT,
      status TEXT,
      assignees TEXT,
      project TEXT,
      updated_at TEXT,
      fetched_at TEXT
    );
    CREATE TABLE task_issues (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      issue_url TEXT NOT NULL REFERENCES issues(url) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (task_id, issue_url)
    );
    CREATE TABLE features (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      problem TEXT NOT NULL DEFAULT '',
      outcome TEXT NOT NULL DEFAULT '',
      non_goals TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT 'problem',
      status TEXT NOT NULL DEFAULT 'active',
      template_id TEXT NOT NULL DEFAULT 'feature-development-v1',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT
    );
    CREATE TABLE feature_tasks (
      feature_id TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (feature_id, task_id)
    );
    CREATE TABLE feature_workflow_owners (
      task_id TEXT PRIMARY KEY NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      feature_id TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE feature_issues (
      feature_id TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
      issue_url TEXT NOT NULL REFERENCES issues(url) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (feature_id, issue_url)
    );
    CREATE TABLE feature_artifacts (
      id TEXT PRIMARY KEY NOT NULL,
      feature_id TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      uri TEXT NOT NULL,
      content_hash TEXT,
      source_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      source_room_id TEXT,
      source_message_id TEXT,
      source_member_id TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      approved_at TEXT
    );
    CREATE TABLE feature_events (
      id TEXT PRIMARY KEY NOT NULL,
      feature_id TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      actor_type TEXT NOT NULL DEFAULT 'user',
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE team_rooms (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      feature_id TEXT,
      name TEXT NOT NULL,
      preset TEXT NOT NULL DEFAULT 'freeform',
      status TEXT NOT NULL DEFAULT 'active',
      routing_hop_limit INTEGER NOT NULL DEFAULT 100,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_team_rooms_active_feature_workflow_task
      ON team_rooms (project_id, task_id)
      WHERE preset = 'feature-workflow' AND status = 'active';
  `);
}

function seedProjectsAndTasks(db: Database.Database): void {
  db.exec(`
    INSERT INTO projects (id) VALUES ('project-1'), ('project-2');
    INSERT INTO tasks (id, project_id, name, status)
    VALUES
      ('task-1', 'project-1', 'Implement feature', 'in_progress'),
      ('other-task', 'project-2', 'Other project task', 'done');
  `);
}
