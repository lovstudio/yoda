import { describe, expect, it } from 'vitest';
import {
  createExpoGoPairingUrl,
  createMobilePairingUrl,
  parseMobilePairingUrl,
  sortMobileProjects,
  sortMobileProjectsByUpdatedAt,
  type MobileProjectSummary,
} from './mobile-api';

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
    options: { displayName?: string; isOpen?: boolean } = {}
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
    };
  }

  it('sorts projects by latest modification without mutating the snapshot', () => {
    const projects = [
      project('older', '2026-07-28T08:00:00.000Z'),
      project('newest', '2026-07-31T08:00:00.000Z'),
      project('middle', '2026-07-30T08:00:00.000Z'),
    ];

    expect(sortMobileProjectsByUpdatedAt(projects).map(({ id }) => id)).toEqual([
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

    expect(sortMobileProjectsByUpdatedAt(projects).map(({ id }) => id)).toEqual([
      'valid-a',
      'valid-b',
      'invalid-a',
      'invalid-b',
    ]);
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
});
