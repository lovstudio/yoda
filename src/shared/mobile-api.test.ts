import { describe, expect, it } from 'vitest';
import {
  canContinueMobileSession,
  createExpoGoPairingUrl,
  createMobilePairingUrl,
  getMobileProjectActivityById,
  parseMobilePairingUrl,
  sortMobileProjects,
  sortMobileTaskAttributionCandidates,
  type MobileProjectSummary,
  type MobileTaskSummary,
} from './mobile-api';

describe('mobile session continuation', () => {
  it('keeps both live and cold-resumable sessions actionable', () => {
    expect(canContinueMobileSession({ acceptsInput: true, resumable: false })).toBe(true);
    expect(canContinueMobileSession({ acceptsInput: false, resumable: true })).toBe(true);
    expect(canContinueMobileSession({ acceptsInput: false, resumable: false })).toBe(false);
    expect(canContinueMobileSession(null)).toBe(false);
  });
});

describe('mobile pairing links', () => {
  it('round-trips a gateway connection through the mobile deep link', () => {
    const connection = {
      baseUrl: 'http://192.168.1.10:3879',
      token: 'mobile-token',
    };

    const url = createMobilePairingUrl(connection);

    expect(url).toBe(
      'yodamobile://connect?baseUrl=http%3A%2F%2F192.168.1.10%3A3879&token=mobile-token'
    );
    expect(parseMobilePairingUrl(url)).toEqual(connection);
  });

  it('round-trips a gateway connection through the Expo Go local URL', () => {
    const connection = {
      baseUrl: 'http://192.168.1.10:3879',
      token: 'mobile-token',
    };

    const url = createExpoGoPairingUrl('exp://192.168.1.10:8081', connection);

    expect(url).toBe(
      'exp://192.168.1.10:8081/--/connect?baseUrl=http%3A%2F%2F192.168.1.10%3A3879&token=mobile-token'
    );
    expect(parseMobilePairingUrl(url)).toEqual(connection);
  });

  it('parses Expo Go local URLs after exp is normalized to http', () => {
    const connection = {
      baseUrl: 'http://192.168.1.10:3879',
      token: 'mobile-token',
    };

    expect(
      parseMobilePairingUrl(
        'http://192.168.1.10:8081/--/connect?baseUrl=http%3A%2F%2F192.168.1.10%3A3879&token=mobile-token'
      )
    ).toEqual(connection);
  });

  it('rejects invalid pairing links', () => {
    expect(parseMobilePairingUrl('https://lovstudio.ai/yoda/mobile')).toBeNull();
    expect(
      parseMobilePairingUrl('yodamobile://connect?baseUrl=http%3A%2F%2F192.168.1.10%3A3879')
    ).toBeNull();
    expect(parseMobilePairingUrl('not a url')).toBeNull();
  });
});

describe('mobile project ordering', () => {
  function project(
    id: string,
    updatedAt: string,
    options: { displayName?: string; isOpen?: boolean; lastActivityAt?: string } = {}
  ): MobileProjectSummary {
    return {
      id,
      name: id,
      displayName: options.displayName ?? id,
      type: 'local',
      path: `/projects/${id}`,
      isInternal: false,
      isOpen: options.isOpen ?? false,
      updatedAt,
      lastActivityAt: options.lastActivityAt,
    };
  }

  it('sorts projects by latest activity without mutating the snapshot', () => {
    const projects = [
      project('older', '2026-07-28T08:00:00.000Z'),
      project('newest', '2026-07-31T08:00:00.000Z'),
      project('middle', '2026-07-30T08:00:00.000Z'),
    ];

    expect(sortMobileProjects(projects, 'recent').map(({ id }) => id)).toEqual([
      'newest',
      'middle',
      'older',
    ]);
    expect(projects.map(({ id }) => id)).toEqual(['older', 'newest', 'middle']);
  });

  it('keeps invalid and tied timestamps stable at the end', () => {
    const projects = [
      project('invalid-a', 'unknown'),
      project('valid-a', '2026-07-31T08:00:00.000Z'),
      project('invalid-b', ''),
      project('valid-b', '2026-07-31T08:00:00.000Z'),
    ];

    expect(sortMobileProjects(projects, 'recent').map(({ id }) => id)).toEqual([
      'valid-a',
      'valid-b',
      'invalid-a',
      'invalid-b',
    ]);
  });

  it('uses task activity instead of stale project metadata for recent ordering', () => {
    const projects = [
      project('metadata-newer', '2026-07-31T08:00:00.000Z'),
      project('task-active', '2026-06-08T08:00:00.000Z', {
        lastActivityAt: '2026-08-01T00:43:00.000Z',
      }),
    ];

    expect(sortMobileProjects(projects, 'recent').map(({ id }) => id)).toEqual([
      'task-active',
      'metadata-newer',
    ]);
  });

  it('parses SQLite timestamps as UTC on native clients', () => {
    const projects = [
      project('iso', '2026-07-31T16:59:59.000Z'),
      project('sqlite', '2026-07-31 17:00:00'),
    ];

    expect(sortMobileProjects(projects, 'recent').map(({ id }) => id)).toEqual(['sqlite', 'iso']);
  });

  it('sorts projects by display name using natural ordering', () => {
    const projects = [
      project('ten', '2026-07-31T08:00:00.000Z', { displayName: 'Project 10' }),
      project('alpha', '2026-07-29T08:00:00.000Z', { displayName: 'alpha' }),
      project('two', '2026-07-30T08:00:00.000Z', { displayName: 'Project 2' }),
    ];

    expect(sortMobileProjects(projects, 'name').map(({ id }) => id)).toEqual([
      'alpha',
      'two',
      'ten',
    ]);
  });

  it('sorts open projects first and keeps each group in recent order', () => {
    const projects = [
      project('closed-newest', '2026-07-31T08:00:00.000Z'),
      project('open-older', '2026-07-28T08:00:00.000Z', { isOpen: true }),
      project('closed-older', '2026-07-27T08:00:00.000Z'),
      project('open-newest', '2026-07-30T08:00:00.000Z', { isOpen: true }),
    ];

    expect(sortMobileProjects(projects, 'open').map(({ id }) => id)).toEqual([
      'open-newest',
      'open-older',
      'closed-newest',
      'closed-older',
    ]);
  });

  it('derives project activity from the latest task interaction with project fallback', () => {
    const projects = [
      project('active', '2026-06-08T08:00:00.000Z'),
      project('empty', '2026-07-30T08:00:00.000Z'),
    ];
    const activityByProjectId = getMobileProjectActivityById(projects, [
      {
        projectId: 'active',
        createdAt: '2026-07-31 14:04:46',
        lastInteractedAt: '2026-07-31T16:43:51.748Z',
      },
      {
        projectId: 'active',
        createdAt: '2026-07-30 10:00:00',
        lastInteractedAt: undefined,
      },
    ]);

    expect(activityByProjectId.get('active')).toBe('2026-07-31T16:43:51.748Z');
    expect(activityByProjectId.get('empty')).toBe('2026-07-30T08:00:00.000Z');
  });
});

describe('mobile task attribution ordering', () => {
  function task(
    id: string,
    updatedAt: string,
    options: { isLongTerm?: boolean; isPinned?: boolean; lastInteractedAt?: string } = {}
  ): MobileTaskSummary {
    return {
      id,
      projectId: 'project-1',
      name: id,
      status: 'todo',
      activityStatus: 'todo',
      bootstrapStatus: { status: 'not-started' },
      updatedAt,
      lastInteractedAt: options.lastInteractedAt,
      needsReview: false,
      isPinned: options.isPinned ?? false,
      isLongTerm: options.isLongTerm ?? false,
      conversationCount: 0,
      runtimeCounts: {},
    };
  }

  it('keeps long-term parents visible before ordinary recent tasks', () => {
    const tasks = [
      task('ordinary-new', '2026-08-05T12:00:00.000Z'),
      task('long-term-old', '2026-07-01T12:00:00.000Z', { isLongTerm: true }),
      task('long-term-new', '2026-08-04T12:00:00.000Z', { isLongTerm: true }),
    ];

    expect(sortMobileTaskAttributionCandidates(tasks).map(({ id }) => id)).toEqual([
      'long-term-new',
      'long-term-old',
      'ordinary-new',
    ]);
    expect(tasks.map(({ id }) => id)).toEqual(['ordinary-new', 'long-term-old', 'long-term-new']);
  });

  it('uses pinned state, interaction time, and natural name order as stable fallbacks', () => {
    const tasks = [
      task('Task 10', 'unknown'),
      task('Task 2', 'unknown'),
      task('recent', '2026-08-01T00:00:00.000Z', {
        lastInteractedAt: '2026-08-03T00:00:00.000Z',
      }),
      task('pinned', '2026-07-01T00:00:00.000Z', { isPinned: true }),
    ];

    expect(sortMobileTaskAttributionCandidates(tasks).map(({ id }) => id)).toEqual([
      'pinned',
      'recent',
      'Task 2',
      'Task 10',
    ]);
  });
});
